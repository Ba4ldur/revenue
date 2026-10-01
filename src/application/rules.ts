import { z } from "zod";
import { RULE_TYPES, RULE_UNITS, MONEY_RULE_TYPES, UNIT_RULE_TYPES, type RuleType } from "@/domain/contracts/rules";
import { parseDecimalCell } from "@/domain/imports/normalization";
import { parseIsoDate } from "@/domain/competence";
import { hashCanonical } from "@/domain/hashing";
import { setAuditIntent } from "@/infrastructure/db/client";
import { EXTRACTION_PROMPT, ExtractionRefusedError, validateExtraction, type ContractExtractionProvider } from "@/ai/contract-extraction";
import { assertUuid, requirePermission, userTx, type OrgContext } from "./context";
import { AppError, fromDbError, invalid, notFound } from "./errors";
import { logger } from "@/lib/logger";

export interface ContractRule {
  id: string;
  contractId: string;
  contractVersionId: string;
  versionNumber: number;
  ruleType: RuleType;
  status: string;
  numericValue: string | null;
  textValue: string | null;
  unit: string | null;
  validFrom: string;
  validUntil: string | null;
  sourceType: string;
  sourceDocumentId: string;
  sourceDocumentName: string | null;
  sourcePage: number | null;
  sourceText: string;
  sourceVerified: boolean;
  extractionConfidence: string | null;
  extractedPayload: unknown;
  confirmedByEmail: string | null;
  confirmedAt: string | null;
  activatedAt: string | null;
  rejectionReason: string | null;
  supersededAt: string | null;
  supersededByRuleId: string | null;
  createdAt: string;
}

const ts = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export function mapRule(r: Record<string, unknown>): ContractRule {
  return {
    id: r.id as string,
    contractId: r.contract_id as string,
    contractVersionId: r.contract_version_id as string,
    versionNumber: (r.version_number as number) ?? 0,
    ruleType: r.rule_type as RuleType,
    status: r.status as string,
    numericValue: (r.numeric_value as string | null) ?? null,
    textValue: (r.text_value as string | null) ?? null,
    unit: (r.unit as string | null) ?? null,
    validFrom: r.valid_from as string,
    validUntil: (r.valid_until as string | null) ?? null,
    sourceType: r.source_type as string,
    sourceDocumentId: r.source_document_id as string,
    sourceDocumentName: (r.document_name as string | null) ?? null,
    sourcePage: (r.source_page as number | null) ?? null,
    sourceText: r.source_text as string,
    sourceVerified: r.source_verified as boolean,
    extractionConfidence: (r.extraction_confidence as string | null) ?? null,
    extractedPayload: r.extracted_payload ?? null,
    confirmedByEmail: (r.confirmer_email as string | null) ?? null,
    confirmedAt: ts(r.confirmed_at),
    activatedAt: ts(r.activated_at),
    rejectionReason: (r.rejection_reason as string | null) ?? null,
    supersededAt: ts(r.superseded_at),
    supersededByRuleId: (r.superseded_by_rule_id as string | null) ?? null,
    createdAt: ts(r.created_at)!,
  };
}

export async function listRules(ctx: OrgContext, contractId: string): Promise<ContractRule[]> {
  assertUuid(contractId);
  return userTx(ctx, async (tx) => {
    const rows = await tx`
      select r.*, v.version_number, d.file_name as document_name, u.email as confirmer_email
      from app.contract_rules r
      join app.contract_versions v on v.id = r.contract_version_id
      join app.contract_documents d on d.id = r.source_document_id
      left join app.users u on u.id = r.confirmed_by
      where r.contract_id = ${contractId} and r.organization_id = ${ctx.orgId}
      order by v.version_number, array_position(array['ACTIVE','CONFIRMED','PROPOSED','SUPERSEDED','REJECTED'], r.status), r.rule_type, r.created_at`;
    return rows.map(mapRule);
  });
}

// ---------------------------------------------------------------------------------------
// Extração por IA (gera somente PROPOSED)
// ---------------------------------------------------------------------------------------

export async function extractRulesFromDocument(
  ctx: OrgContext,
  documentId: string,
  provider: ContractExtractionProvider | null,
): Promise<{ runId: string; proposals: number; discarded: number; reused: boolean }> {
  requirePermission(ctx, "rules.propose");
  assertUuid(documentId);
  if (!provider) throw new AppError("AI_DISABLED", "Extração por IA não está configurada nesta instalação; cadastre as regras manualmente com o trecho do contrato", 409);

  const doc: { pages: Array<Record<string, unknown>>; sha256_hash: string; contract_id: string; contract_version_id: string; version_valid_from: string } = await userTx(ctx, async (tx) => {
    const [d] = await tx`
      select d.*, v.valid_from as version_valid_from from app.contract_documents d
      left join app.contract_versions v on v.id = d.contract_version_id
      where d.id = ${documentId} and d.organization_id = ${ctx.orgId} and d.deleted_at is null`;
    if (!d) throw notFound("Documento");
    if (!d.contract_version_id) throw invalid("Vincule o documento a uma versão do contrato antes de extrair regras");
    if (d.text_status !== "COMPLETED") throw invalid("Documento sem texto extraível (PDF escaneado?). Cadastre as regras manualmente.");
    const pages = await tx`select page_number, text from app.contract_document_pages where document_id = ${documentId} order by page_number`;
    return { sha256_hash: d.sha256_hash, contract_id: d.contract_id, contract_version_id: d.contract_version_id, version_valid_from: d.version_valid_from, pages };
  });

  const idempotencyKey = `${documentId}:${EXTRACTION_PROMPT.name}@${EXTRACTION_PROMPT.version}:${provider.name}:${provider.model}`;
  const inputHash = hashCanonical({ sha256: doc.sha256_hash, prompt: EXTRACTION_PROMPT, provider: provider.name, model: provider.model });

  // Reserva idempotente: execução concluída é reutilizada; execução presa > 10 min é encerrada.
  const reservation = await userTx(ctx, async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${"extract:" + idempotencyKey}, 0))`;
    const [existing] = await tx`
      select id, status, proposals_count, started_at, output from app.rule_extraction_runs
      where organization_id = ${ctx.orgId} and idempotency_key = ${idempotencyKey} and status in ('PENDING','RUNNING','COMPLETED')`;
    if (existing?.status === "COMPLETED") {
      const disc = (existing.output as { discarded?: unknown[] } | null)?.discarded?.length ?? 0;
      return { reused: true as const, runId: existing.id as string, proposals: existing.proposals_count as number, discarded: disc };
    }
    if (existing) {
      const stale = Date.now() - new Date(existing.started_at as string).getTime() > 10 * 60 * 1000;
      if (!stale) throw new AppError("IN_PROGRESS", "Extração já em andamento para este documento", 409);
      await tx`update app.rule_extraction_runs set status = 'FAILED', completed_at = now(),
               error_details = ${tx.json({ kind: "TECHNICAL", code: "STALE", message: "execução interrompida" })} where id = ${existing.id}`;
    }
    await setAuditIntent(tx, "rules.extract");
    const [run] = await tx`
      insert into app.rule_extraction_runs (organization_id, document_id, provider, model, prompt_name, prompt_version, status,
        idempotency_key, input_hash, triggered_by, started_at)
      values (${ctx.orgId}, ${documentId}, ${provider.name}, ${provider.model}, ${EXTRACTION_PROMPT.name}, ${EXTRACTION_PROMPT.version},
        'RUNNING', ${idempotencyKey}, ${inputHash}, ${ctx.userId}, now())
      returning id`;
    return { reused: false as const, runId: run!.id as string };
  });
  if (reservation.reused) return { runId: reservation.runId, proposals: reservation.proposals, discarded: reservation.discarded, reused: true };

  const started = Date.now();
  try {
    const pages = doc.pages.map((p) => ({ pageNumber: p.page_number as number, text: p.text as string }));
    const response = await provider.extract(pages);
    const { proposals, discarded } = validateExtraction(response.output, pages.length);
    await userTx(ctx, async (tx) => {
      await setAuditIntent(tx, "rules.propose");
      for (const p of proposals) {
        await tx`
          insert into app.contract_rules (organization_id, contract_id, contract_version_id, rule_type, numeric_value, text_value, unit,
            valid_from, valid_until, source_type, source_document_id, source_page, source_text, extraction_run_id,
            extraction_confidence, extracted_payload, created_by)
          values (${ctx.orgId}, ${doc.contract_id}, ${doc.contract_version_id}, ${p.ruleType}, ${p.numericValue}, ${p.textValue}, ${p.unit},
            ${p.validFrom ?? doc.version_valid_from}, ${p.validUntil}, 'AI_EXTRACTION', ${documentId}, ${p.sourcePage}, ${p.sourceText},
            ${reservation.runId}, ${p.extractionConfidence}, ${tx.json(p.raw as never)}, ${ctx.userId})`;
      }
      await tx`update app.rule_extraction_runs set status = 'COMPLETED', completed_at = now(), proposals_count = ${proposals.length},
               model = ${response.servedModel}, output = ${tx.json({ raw: response.output, discarded } as never)}
               where id = ${reservation.runId}`;
    });
    logger.info("rules.extracted", { org: ctx.orgId, run: reservation.runId, proposals: proposals.length, discarded: discarded.length, ms: Date.now() - started });
    return { runId: reservation.runId, proposals: proposals.length, discarded: discarded.length, reused: false };
  } catch (e) {
    const refused = e instanceof ExtractionRefusedError;
    logger.error("rules.extraction_failed", { org: ctx.orgId, run: reservation.runId, refused, error: (e as Error).message.slice(0, 300) });
    await userTx(ctx, (tx) => tx`
      update app.rule_extraction_runs set status = 'FAILED', completed_at = now(),
        error_details = ${tx.json({ kind: refused ? "REFUSED" : "TECHNICAL", message: (e as Error).message.slice(0, 500) })}
      where id = ${reservation.runId}`);
    throw new AppError("EXTRACTION_FAILED", refused ? "O provedor de IA recusou a extração. Cadastre as regras manualmente." : "Falha na extração por IA; nenhuma regra foi criada.", 502);
  }
}

// ---------------------------------------------------------------------------------------
// Regras manuais e revisão humana
// ---------------------------------------------------------------------------------------

const RuleFields = z.object({
  ruleType: z.enum(RULE_TYPES),
  value: z.string().trim().max(60).optional().nullable(),
  textValue: z.string().trim().max(2000).optional().nullable(),
  unit: z.enum(RULE_UNITS).optional().nullable(),
  validFrom: z.string().trim().min(1),
  validUntil: z.string().trim().optional().nullable(),
  sourcePage: z.coerce.number().int().min(1).optional().nullable(),
  sourceText: z.string().trim().min(3, "Trecho do contrato obrigatório").max(4000),
});

/** Valor informado na interface no formato brasileiro (18.000,00). */
function ruleValues(f: z.infer<typeof RuleFields>) {
  let numeric: string | null = null;
  if (f.value) {
    const d = parseDecimalCell(f.value, "BR");
    if (!d.ok) throw invalid(`Valor: ${d.error}`);
    if (d.value.isNegative()) throw invalid("Valor não pode ser negativo");
    if (MONEY_RULE_TYPES.has(f.ruleType) && d.value.decimalPlaces() > 2) throw invalid("Valor monetário com mais de 2 casas");
    numeric = f.ruleType === "DISCOUNT_PERCENTAGE" ? d.value.dividedBy(100).toFixed() : d.value.toFixed();
  }
  if ((MONEY_RULE_TYPES.has(f.ruleType) || UNIT_RULE_TYPES.has(f.ruleType)) && numeric === null) throw invalid("Valor obrigatório para este tipo de regra");
  if (UNIT_RULE_TYPES.has(f.ruleType) && !f.unit) throw invalid("Unidade obrigatória para este tipo de regra");
  const from = parseIsoDate(f.validFrom);
  if (!from.ok) throw invalid(`Vigência inicial: ${from.error}`);
  const until = f.validUntil ? parseIsoDate(f.validUntil) : null;
  if (until && !until.ok) throw invalid(`Vigência final: ${until.error}`);
  return {
    numeric,
    text: numeric === null ? f.textValue || f.sourceText : f.textValue || null,
    unit: UNIT_RULE_TYPES.has(f.ruleType) ? f.unit! : null,
    validFrom: from.value,
    validUntil: until && until.ok ? until.value : null,
  };
}

export async function createManualRule(ctx: OrgContext, input: unknown): Promise<string> {
  requirePermission(ctx, "rules.propose");
  const p = RuleFields.extend({ contractVersionId: z.string().uuid(), sourceDocumentId: z.string().uuid() }).safeParse(input);
  if (!p.success) throw invalid(p.error.issues[0]?.message ?? "Regra inválida");
  const v = ruleValues(p.data);
  try {
    return await userTx(ctx, async (tx) => {
      const [ver] = await tx`select contract_id from app.contract_versions where id = ${p.data.contractVersionId} and organization_id = ${ctx.orgId}`;
      if (!ver) throw notFound("Versão");
      await setAuditIntent(tx, "rule.manual_create");
      const [r] = await tx`
        insert into app.contract_rules (organization_id, contract_id, contract_version_id, rule_type, numeric_value, text_value, unit,
          valid_from, valid_until, source_type, source_document_id, source_page, source_text, created_by)
        values (${ctx.orgId}, ${ver.contract_id}, ${p.data.contractVersionId}, ${p.data.ruleType}, ${v.numeric}, ${v.text}, ${v.unit},
          ${v.validFrom}, ${v.validUntil}, 'MANUAL_ENTRY', ${p.data.sourceDocumentId}, ${p.data.sourcePage ?? null}, ${p.data.sourceText},
          ${ctx.userId})
        returning id`;
      return r!.id as string;
    });
  } catch (e) {
    throw fromDbError(e);
  }
}

/** Confirmação humana; ajustes do revisor são aplicados enquanto PROPOSED (payload da IA é preservado). */
export async function confirmRule(ctx: OrgContext, ruleId: string, edits?: unknown): Promise<void> {
  requirePermission(ctx, "rules.review");
  assertUuid(ruleId);
  try {
    await userTx(ctx, async (tx) => {
      const [r] = await tx`select * from app.contract_rules where id = ${ruleId} and organization_id = ${ctx.orgId} for update`;
      if (!r) throw notFound("Regra");
      if (r.status !== "PROPOSED") throw invalid("Somente regras propostas podem ser confirmadas");
      if (edits) {
        const p = RuleFields.safeParse(edits);
        if (!p.success) throw invalid(p.error.issues[0]?.message ?? "Ajuste inválido");
        const v = ruleValues(p.data);
        await setAuditIntent(tx, "rule.review_edit");
        await tx`update app.contract_rules set rule_type = ${p.data.ruleType}, numeric_value = ${v.numeric}, text_value = ${v.text},
                 unit = ${v.unit}, valid_from = ${v.validFrom}, valid_until = ${v.validUntil}, source_page = ${p.data.sourcePage ?? null},
                 source_text = ${p.data.sourceText} where id = ${ruleId}`;
      }
      await setAuditIntent(tx, "rule.confirm");
      await tx`update app.contract_rules set status = 'CONFIRMED', confirmed_by = ${ctx.userId}, confirmed_at = now() where id = ${ruleId}`;
    });
  } catch (e) {
    throw fromDbError(e);
  }
}

export async function rejectRule(ctx: OrgContext, ruleId: string, reason: string): Promise<void> {
  requirePermission(ctx, "rules.review");
  assertUuid(ruleId);
  if (!reason || reason.trim().length < 3) throw invalid("Informe o motivo da rejeição");
  try {
    await userTx(ctx, async (tx) => {
      await setAuditIntent(tx, "rule.reject");
      const r = await tx`update app.contract_rules set status = 'REJECTED', rejected_by = ${ctx.userId}, rejected_at = now(),
                         rejection_reason = ${reason.trim()} where id = ${ruleId} and organization_id = ${ctx.orgId}
                         and status in ('PROPOSED', 'CONFIRMED')`;
      if (r.count === 0) throw invalid("Regra não pode ser rejeitada no estado atual");
    });
  } catch (e) {
    throw fromDbError(e);
  }
}

/**
 * Ativa regra CONFIRMED. Se substitui outra regra ACTIVE (correção — TESTE 13), a antiga vira
 * SUPERSEDED na mesma transação e é preservada. Retorna competências já calculadas que
 * precisam de reprocessamento.
 */
export async function activateRule(ctx: OrgContext, ruleId: string, replacesRuleId?: string | null): Promise<{ affectedCompetences: string[] }> {
  requirePermission(ctx, "rules.review");
  assertUuid(ruleId);
  if (replacesRuleId) assertUuid(replacesRuleId);
  try {
    return await userTx(ctx, async (tx) => {
      const [r] = await tx`select * from app.contract_rules where id = ${ruleId} and organization_id = ${ctx.orgId} for update`;
      if (!r) throw notFound("Regra");
      if (r.status !== "CONFIRMED") throw invalid("Somente regras confirmadas podem ser ativadas");
      if (replacesRuleId) {
        const [old] = await tx`select * from app.contract_rules where id = ${replacesRuleId} and organization_id = ${ctx.orgId} for update`;
        if (!old || old.status !== "ACTIVE") throw invalid("A regra substituída precisa estar ativa");
        if (old.contract_version_id !== r.contract_version_id || old.rule_type !== r.rule_type || old.unit !== r.unit) {
          throw invalid("A substituição exige mesma versão, tipo e unidade");
        }
        await setAuditIntent(tx, "rule.supersede");
        await tx`update app.contract_rules set status = 'SUPERSEDED', superseded_at = now(), superseded_by_rule_id = ${ruleId}
                 where id = ${replacesRuleId}`;
      }
      await setAuditIntent(tx, "rule.activate");
      await tx`update app.contract_rules set status = 'ACTIVE', activated_by = ${ctx.userId}, activated_at = now() where id = ${ruleId}`;
      const comps = await tx`select distinct competence from app.calculation_runs
                             where contract_id = ${r.contract_id} and organization_id = ${ctx.orgId} and status in ('COMPLETED','FAILED')
                             order by competence`;
      return { affectedCompetences: comps.map((c) => c.competence as string) };
    });
  } catch (e) {
    throw fromDbError(e);
  }
}
