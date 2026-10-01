import { z } from "zod";
import { asCompetence, competenceRange, isCompetence, type Competence } from "@/domain/competence";
import { setAuditIntent } from "@/infrastructure/db/client";
import { requirePermission, systemTx, userTx, type OrgContext } from "./context";
import { AppError, fromDbError, invalid } from "./errors";
import { competencesWithData, runRevenueAssurance, type PipelineOptions, type PipelineResult } from "./calculations";
import { logger } from "@/lib/logger";

/**
 * REPROCESSING: mudança → escopo → ReprocessingJob → novos CalculationRuns → comparação
 * antigo × novo → histórico preservado (runs antigos ficam SUPERSEDED, nunca apagados).
 */

const JobInput = z.object({
  reason: z.string().trim().min(3).max(1000),
  triggerEntityType: z.string().max(80).optional().nullable(),
  triggerEntityId: z.string().uuid().optional().nullable(),
  contractIds: z.array(z.string().uuid()).max(500).optional(),
  affectedFrom: z.string().refine(isCompetence, "competência inicial inválida"),
  affectedUntil: z.string().refine(isCompetence, "competência final inválida"),
  idempotencyKey: z.string().min(8).max(200).optional().nullable(),
});

interface ScopeItem {
  contractId: string;
  competence: Competence;
  before: { expectedTotal: string | null; difference: string | null; findingId: string | null };
}

export interface ReprocessingSummary {
  jobId: string;
  status: string;
  items: Array<{
    contract_id: string;
    competence: string;
    before: ScopeItem["before"];
    after: { expected_status: string; reconciliation_status: string; expected_total: string | null; difference: string | null; finding_id: string | null; code?: string };
    changed: boolean;
  }>;
}

export async function createAndRunReprocessing(ctx: OrgContext, input: unknown, opts: Pick<PipelineOptions, "engines"> = {}): Promise<ReprocessingSummary> {
  requirePermission(ctx, "calculations.run");
  const p = JobInput.safeParse(input);
  if (!p.success) throw invalid(p.error.issues[0]?.message ?? "Reprocessamento inválido");
  if (p.data.affectedUntil < p.data.affectedFrom) throw invalid("Intervalo de competências invertido");

  let jobId: string;
  try {
    jobId = await userTx(ctx, async (tx) => {
      if (p.data.idempotencyKey) {
        const [ex] = await tx`select id from app.reprocessing_jobs where organization_id = ${ctx.orgId} and idempotency_key = ${p.data.idempotencyKey}`;
        if (ex) throw new AppError("DUPLICATE_JOB", "Reprocessamento já registrado com esta chave", 409, { jobId: ex.id });
      }
      const contracts = p.data.contractIds?.length
        ? p.data.contractIds
        : (await tx`select id from app.contracts where organization_id = ${ctx.orgId} and deleted_at is null`).map((r) => r.id as string);
      await setAuditIntent(tx, "reprocessing.create");
      const [j] = await tx`
        insert into app.reprocessing_jobs (organization_id, reason, trigger_entity_type, trigger_entity_id, affected_from, affected_until,
          affected_contract_ids, status, idempotency_key, created_by)
        values (${ctx.orgId}, ${p.data.reason}, ${p.data.triggerEntityType ?? null}, ${p.data.triggerEntityId ?? null}, ${p.data.affectedFrom},
          ${p.data.affectedUntil}, ${contracts}, 'PENDING', ${p.data.idempotencyKey ?? null}, ${ctx.userId})
        returning id`;
      return j!.id as string;
    });
  } catch (e) {
    throw fromDbError(e);
  }
  return runReprocessingJob(ctx, jobId, opts);
}

export async function runReprocessingJob(ctx: OrgContext, jobId: string, opts: Pick<PipelineOptions, "engines"> = {}): Promise<ReprocessingSummary> {
  requirePermission(ctx, "calculations.run");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const job: Record<string, any> = await userTx(ctx, async (tx) => {
    const [j] = await tx`select * from app.reprocessing_jobs where id = ${jobId} and organization_id = ${ctx.orgId} for update`;
    if (!j) throw invalid("Job não encontrado");
    if (j.status === "COMPLETED") return { ...j, alreadyDone: true };
    if (j.status === "RUNNING") throw new AppError("IN_PROGRESS", "Reprocessamento em andamento", 409);
    await tx`update app.reprocessing_jobs set status = 'RUNNING', started_at = now() where id = ${jobId}`;
    return { ...j, alreadyDone: false };
  });
  if (job.alreadyDone) return { jobId, status: "COMPLETED", items: (job.result_summary as { items?: ReprocessingSummary["items"] })?.items ?? [] };

  const started = Date.now();
  try {
    // Escopo: (contrato × competência) com dados dentro do intervalo pedido.
    const range = new Set(competenceRange(asCompetence(job.affected_from as string), asCompetence(job.affected_until as string)));
    const scope: ScopeItem[] = await systemTx(ctx, async (tx) => {
      const out: ScopeItem[] = [];
      for (const contractId of job.affected_contract_ids as string[]) {
        for (const c of await competencesWithData(tx, ctx.orgId, contractId)) {
          if (!range.has(c as Competence)) continue;
          const [cur] = await tx`
            select e.expected_total, (r.result_summary->>'difference_amount') as difference, f.id as finding_id
            from app.calculation_runs x
            left join app.expected_revenue_events e on e.calculation_run_id = x.id
            left join app.calculation_runs r on r.parent_run_id = x.id and r.status = 'COMPLETED'
            left join app.findings f on f.calculation_run_id = r.id
            where x.organization_id = ${ctx.orgId} and x.contract_id = ${contractId} and x.competence = ${c}
              and x.calculation_type = 'EXPECTED_REVENUE' and x.status = 'COMPLETED'`;
          out.push({ contractId, competence: c as Competence, before: { expectedTotal: cur?.expected_total ?? null, difference: cur?.difference ?? null, findingId: cur?.finding_id ?? null } });
        }
      }
      return out;
    });

    const items: ReprocessingSummary["items"] = [];
    for (const s of scope) {
      let r: PipelineResult | null = null;
      let code: string | undefined;
      try {
        r = await runRevenueAssurance(ctx, s.contractId, s.competence, { trigger: "REPROCESSING", reprocessingJobId: jobId, engines: opts.engines });
      } catch (e) {
        code = e instanceof AppError ? e.code : "ERROR";
      }
      const after = {
        expected_status: r?.expected.status ?? "FAILED",
        reconciliation_status: r?.reconciliation.status ?? "FAILED",
        expected_total: r?.expected.expectedTotal ?? null,
        difference: r?.reconciliation.differenceAmount ?? null,
        finding_id: r?.findingId ?? null,
        code: code ?? r?.expected.code ?? r?.reconciliation.code,
      };
      items.push({
        contract_id: s.contractId, competence: s.competence, before: s.before, after,
        changed: s.before.expectedTotal !== after.expected_total || s.before.difference !== after.difference || s.before.findingId !== after.finding_id,
      });
    }
    await userTx(ctx, async (tx) => {
      await setAuditIntent(tx, "reprocessing.complete");
      await tx`update app.reprocessing_jobs set status = 'COMPLETED', completed_at = now(),
               result_summary = ${tx.json({ items, scope_size: items.length, changed: items.filter((i) => i.changed).length } as never)}
               where id = ${jobId}`;
    });
    logger.info("reprocessing.completed", { org: ctx.orgId, job: jobId, items: items.length, ms: Date.now() - started });
    return { jobId, status: "COMPLETED", items };
  } catch (e) {
    await userTx(ctx, (tx) => tx`update app.reprocessing_jobs set status = 'FAILED', completed_at = now(),
                                 error_details = ${tx.json({ message: (e as Error).message.slice(0, 500) })} where id = ${jobId}`);
    throw fromDbError(e);
  }
}

export async function listReprocessingJobs(ctx: OrgContext) {
  return userTx(ctx, (tx) => tx`
    select j.id, j.reason, j.status, j.affected_from, j.affected_until, j.created_at, j.completed_at,
      (j.result_summary->>'scope_size')::int as scope_size, (j.result_summary->>'changed')::int as changed, u.email as creator_email
    from app.reprocessing_jobs j left join app.users u on u.id = j.created_by
    where j.organization_id = ${ctx.orgId} order by j.created_at desc limit 100`);
}
