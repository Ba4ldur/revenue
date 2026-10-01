import { z } from "zod";
import { parseDecimalCell } from "@/domain/imports/normalization";
import { setAuditIntent } from "@/infrastructure/db/client";
import { assertUuid, can, requirePermission, userTx, type OrgContext } from "./context";
import { forbidden, fromDbError, invalid, notFound } from "./errors";

export const FINDING_STATUSES = ["OPEN", "UNDER_REVIEW", "CONFIRMED", "JUSTIFIED", "FALSE_POSITIVE", "DISCARDED", "RECOVERED"] as const;
export const FINDING_STATUS_LABELS: Record<string, string> = {
  OPEN: "Aberto",
  UNDER_REVIEW: "Em revisão",
  CONFIRMED: "Confirmado",
  JUSTIFIED: "Justificado",
  FALSE_POSITIVE: "Falso positivo",
  DISCARDED: "Descartado",
  RECOVERED: "Recuperado",
};
export const ACTION_LABELS: Record<string, string> = {
  START_REVIEW: "Iniciar revisão",
  CONFIRM: "Confirmar divergência",
  JUSTIFY: "Justificar",
  MARK_FALSE_POSITIVE: "Marcar falso positivo",
  DISCARD: "Descartar",
  MARK_RECOVERED: "Registrar recuperação",
  REOPEN: "Reabrir",
  NOTE: "Anotação",
};

/** Ações disponíveis por status (espelha o trigger app.finding_actions_apply). */
export function availableActions(status: string, ctx: Pick<OrgContext, "role">, isCurrent: boolean): string[] {
  if (!isCurrent) return can(ctx, "findings.review") ? ["NOTE"] : [];
  const out: string[] = [];
  if (can(ctx, "findings.review")) {
    if (status === "OPEN") out.push("START_REVIEW");
    out.push("NOTE");
  }
  if (can(ctx, "findings.classify")) {
    if (status === "OPEN" || status === "UNDER_REVIEW") out.push("CONFIRM", "JUSTIFY", "MARK_FALSE_POSITIVE", "DISCARD");
    if (status === "CONFIRMED") out.push("MARK_RECOVERED");
    if (["CONFIRMED", "JUSTIFIED", "FALSE_POSITIVE", "DISCARDED"].includes(status)) out.push("REOPEN");
  }
  return out;
}

export interface FindingFilters {
  status?: string;
  type?: string;
  competence?: string;
  contractId?: string;
  includeSuperseded?: boolean;
}

export async function listFindings(ctx: OrgContext, f: FindingFilters = {}) {
  return userTx(ctx, (tx) => tx`
    select f.id, f.finding_type, f.status, f.severity, f.competence, f.expected_amount, f.billed_amount, f.difference_amount,
      f.detected_at, f.evidence_completeness, k.contract_number, k.id as contract_id, coalesce(c.trade_name, c.legal_name) as customer_name,
      r.status as run_status, r.engine_version
    from app.findings f
    join app.contracts k on k.id = f.contract_id
    join app.customers c on c.id = f.customer_id
    join app.calculation_runs r on r.id = f.calculation_run_id
    where f.organization_id = ${ctx.orgId}
      and (${f.includeSuperseded ?? false} or r.status = 'COMPLETED')
      and (${f.status ?? null}::text is null or f.status = ${f.status ?? null})
      and (${f.type ?? null}::text is null or f.finding_type = ${f.type ?? null})
      and (${f.competence ?? null}::date is null or f.competence = ${f.competence ?? null})
      and (${f.contractId ?? null}::uuid is null or f.contract_id = ${f.contractId ?? null})
    order by f.difference_amount desc, f.detected_at desc
    limit 500`);
}

export async function getFindingDetail(ctx: OrgContext, id: string) {
  assertUuid(id);
  return userTx(ctx, async (tx) => {
    const [finding] = await tx`
      select f.*, k.contract_number, k.title as contract_title, coalesce(c.trade_name, c.legal_name) as customer_name, c.cnpj as customer_cnpj,
        v.version_number, v.valid_from as version_valid_from, v.valid_until as version_valid_until
      from app.findings f join app.contracts k on k.id = f.contract_id join app.customers c on c.id = f.customer_id
      left join app.contract_versions v on v.id = f.contract_version_id
      where f.id = ${id} and f.organization_id = ${ctx.orgId}`;
    if (!finding) throw notFound("Finding");
    const runs = await tx`
      select id, calculation_type, engine_name, engine_version, status, input_snapshot_hash, rules_version_hash, started_at, completed_at,
        triggered_by_type, result_summary, parent_run_id, supersedes_run_id, superseded_at
      from app.calculation_runs where id in (${finding.calculation_run_id}, (select parent_run_id from app.calculation_runs where id = ${finding.calculation_run_id}))`;
    const [ere] = await tx`select * from app.expected_revenue_events where id = ${finding.expected_revenue_event_id}`;
    const components = await tx`select * from app.expected_revenue_components where expected_revenue_event_id = ${finding.expected_revenue_event_id} order by sort_order`;
    const evidence = await tx`select * from app.finding_evidence where finding_id = ${id} order by sort_order`;
    const actions = await tx`select a.*, u.email as performer_email from app.finding_actions a join app.users u on u.id = a.performed_by
                             where a.finding_id = ${id} order by a.performed_at, a.id`;
    const [latest] = await tx`select id, status, calculation_type, error_details, created_at from app.calculation_runs
                              where contract_id = ${finding.contract_id} and competence = ${finding.competence} order by created_at desc limit 1`;
    const previous = finding.previous_finding_id
      ? (await tx`select id, status, difference_amount, finding_type from app.findings where id = ${finding.previous_finding_id}`)[0] ?? null
      : null;
    const successor = (await tx`select id, status from app.findings where previous_finding_id = ${id} order by created_at desc limit 1`)[0] ?? null;
    const recRun = runs.find((r) => r.id === finding.calculation_run_id);
    const isCurrent = recRun?.status === "COMPLETED";
    return {
      finding, runs, expected: ere, components, evidence, actions, previous, successor, isCurrent,
      staleWarning: latest && latest.status === "FAILED" && new Date(latest.created_at) > new Date(finding.created_at)
        ? (latest.error_details as { message?: string })?.message ?? "Recálculo posterior falhou"
        : null,
      actionsAvailable: availableActions(finding.status as string, ctx, isCurrent),
    };
  });
}

const ActionSchema = z.object({
  action: z.enum(["START_REVIEW", "CONFIRM", "JUSTIFY", "MARK_FALSE_POSITIVE", "DISCARD", "MARK_RECOVERED", "REOPEN", "NOTE"]),
  reason: z.string().trim().max(2000).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  recoveredAmount: z.string().trim().max(40).optional().nullable(),
});

/** Classificação humana: FindingAction é a única via; o trigger valida a transição e grava AuditLog. */
export async function classifyFinding(ctx: OrgContext, findingId: string, input: unknown): Promise<void> {
  assertUuid(findingId);
  const p = ActionSchema.safeParse(input);
  if (!p.success) throw invalid("Ação inválida");
  const a = p.data;
  if (["START_REVIEW", "NOTE"].includes(a.action)) requirePermission(ctx, "findings.review");
  else if (!can(ctx, "findings.classify")) throw forbidden();
  let recovered: string | null = null;
  if (a.action === "MARK_RECOVERED") {
    const d = parseDecimalCell(a.recoveredAmount ?? null, "BR");
    if (!d.ok || d.value.decimalPlaces() > 2 || !d.value.greaterThan(0)) throw invalid("Informe o valor recuperado (ex.: 4.760,00)");
    recovered = d.value.toFixed(2);
  }
  try {
    await userTx(ctx, async (tx) => {
      await setAuditIntent(tx, `finding.${a.action.toLowerCase()}`);
      await tx`
        insert into app.finding_actions (organization_id, finding_id, action_type, previous_status, new_status, reason, notes,
          recovered_amount, performed_by)
        values (${ctx.orgId}, ${findingId}, ${a.action}, 'OPEN', 'OPEN', ${a.reason || null}, ${a.notes || null}, ${recovered}, ${ctx.userId})`;
    });
  } catch (e) {
    throw fromDbError(e);
  }
}
