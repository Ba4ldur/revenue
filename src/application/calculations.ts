import { asCompetence, type Competence } from "@/domain/competence";
import { hashCanonical } from "@/domain/hashing";
import {
  EXPECTED_REVENUE_ENGINE,
  calculateExpectedRevenue,
  type EngineOutcome,
  type ExpectedRevenueInput,
  type ExpectedRevenueResult,
} from "@/domain/revenue/expected-revenue-engine";
import { RECONCILIATION_ENGINE, reconcile, type ReconciliationInput, type ReconciliationOutcome } from "@/domain/reconciliation/reconciliation-engine";
import { mapMateriality } from "./organizations";
import { formatBRL, formatQuantity } from "@/domain/money/decimal";
import { RULE_TYPE_LABELS, UNIT_LABELS, type RuleType } from "@/domain/contracts/rules";
import { setAuditIntent, type Tx } from "@/infrastructure/db/client";
import { assertUuid, requirePermission, systemTx, userTx, type OrgContext } from "./context";
import { AppError, invalid, notFound } from "./errors";
import { logger } from "@/lib/logger";

/**
 * Pipeline de Revenue Assurance por (contrato × competência).
 * Estágio 1: CalculationRun EXPECTED_REVENUE → ExpectedRevenueEvent + componentes.
 * Estágio 2: CalculationRun RECONCILIATION (filho) → Finding OPEN (0..1) + evidências.
 * Uma transação, advisory lock por escopo, idempotência por hash do snapshot (ADR-006/008).
 */

export interface EngineSet {
  expected: { name: string; version: string; calculate: (i: ExpectedRevenueInput) => EngineOutcome };
  reconciliation: { name: string; version: string; reconcile: (i: ReconciliationInput) => ReconciliationOutcome };
}

export const DEFAULT_ENGINES: EngineSet = {
  expected: { ...EXPECTED_REVENUE_ENGINE, calculate: calculateExpectedRevenue },
  reconciliation: { ...RECONCILIATION_ENGINE, reconcile },
};

export type StageStatus = "CREATED" | "REUSED" | "NEEDS_REVIEW" | "FAILED" | "NOT_APPLICABLE" | "SKIPPED";

export interface PipelineResult {
  contractId: string;
  competence: Competence;
  expected: { status: StageStatus; runId: string | null; code?: string; message?: string; expectedTotal?: string };
  reconciliation: { status: StageStatus; runId: string | null; code?: string; message?: string; outcome?: string; differenceAmount?: string };
  findingId: string | null;
}

export interface PipelineOptions {
  trigger?: "USER" | "REPROCESSING";
  reprocessingJobId?: string | null;
  /** Somente testes de versionamento de motor (TESTE 7). */
  engines?: EngineSet;
}

interface Loaded {
  contract: Record<string, unknown>;
  expectedInput: ExpectedRevenueInput;
  billing: Array<Record<string, unknown>>;
  materiality: ReturnType<typeof mapMateriality>;
  otherContracts: number;
}

async function loadInputs(tx: Tx, orgId: string, contractId: string, competence: Competence): Promise<Loaded> {
  const [k] = await tx`select id, customer_id, status, start_date, end_date from app.contracts
                       where id = ${contractId} and organization_id = ${orgId} and deleted_at is null`;
  if (!k) throw notFound("Contrato");
  const versions = await tx`select id, version_number, status, valid_from, valid_until from app.contract_versions
                            where contract_id = ${contractId} and organization_id = ${orgId} and status = 'ACTIVE' order by version_number`;
  const rules = await tx`select id, contract_version_id, rule_type, status, numeric_value, unit, valid_from, valid_until
                         from app.contract_rules where contract_id = ${contractId} and organization_id = ${orgId} and status = 'ACTIVE'
                         order by id`;
  const [other] = await tx`
    select count(*)::int as n from app.contracts
    where organization_id = ${orgId} and customer_id = ${k.customer_id} and id <> ${contractId} and deleted_at is null
      and status in ('ACTIVE', 'TERMINATED') and start_date <= (${competence}::date + interval '1 month - 1 day')::date
      and (end_date is null or end_date >= ${competence}::date)`;
  const events = await tx`select id, contract_id, event_type, quantity, unit from app.operational_events
                          where organization_id = ${orgId} and customer_id = ${k.customer_id} and competence = ${competence}
                            and status = 'ACTIVE' and (contract_id = ${contractId} or contract_id is null) order by id`;
  const billing = await tx`select id, contract_id, amount, document_number from app.billing_events
                           where organization_id = ${orgId} and customer_id = ${k.customer_id} and competence = ${competence}
                             and status = 'ACTIVE' and (contract_id = ${contractId} or contract_id is null) order by id`;
  const [m] = await tx`select * from app.materiality_policies where organization_id = ${orgId} and status = 'ACTIVE'`;
  if (!m) throw new AppError("NO_MATERIALITY", "Organização sem política de materialidade ativa", 409);
  return {
    contract: k,
    otherContracts: other!.n as number,
    billing,
    materiality: mapMateriality(m),
    expectedInput: {
      competence,
      contract: { id: k.id, customerId: k.customer_id, status: k.status, startDate: k.start_date, endDate: k.end_date },
      versions: versions.map((v) => ({ id: v.id, versionNumber: v.version_number, status: v.status, validFrom: v.valid_from, validUntil: v.valid_until })),
      rules: rules.map((r) => ({
        id: r.id, versionId: r.contract_version_id, ruleType: r.rule_type, status: r.status, numericValue: r.numeric_value,
        unit: r.unit, validFrom: r.valid_from, validUntil: r.valid_until,
      })),
      operationalEvents: events.map((e) => ({ id: e.id, contractId: e.contract_id, eventType: e.event_type, quantity: e.quantity, unit: e.unit })),
      otherContractsCoveringCompetence: other!.n as number,
    },
  };
}

async function currentRun(tx: Tx, orgId: string, type: string, contractId: string, competence: string) {
  const [r] = await tx`select * from app.calculation_runs where organization_id = ${orgId} and calculation_type = ${type}
                       and scope_id = ${contractId} and competence = ${competence} and status = 'COMPLETED'`;
  return r ?? null;
}

interface RunInsert {
  orgId: string;
  engine: { name: string; version: string };
  type: "EXPECTED_REVENUE" | "RECONCILIATION";
  contractId: string;
  competence: string;
  status: "RUNNING" | "FAILED";
  snapshot: unknown;
  hash: string;
  rulesHash: string | null;
  parentRunId: string | null;
  supersedesRunId: string | null;
  ctx: OrgContext;
  opts: PipelineOptions;
  errorDetails?: unknown;
}

async function insertRun(tx: Tx, r: RunInsert): Promise<string> {
  const trigger = r.opts.trigger ?? "USER";
  const [row] = await tx`
    insert into app.calculation_runs (organization_id, engine_name, engine_version, calculation_type, scope_id, contract_id, competence,
      status, input_snapshot, input_snapshot_hash, rules_version_hash, parameters, triggered_by_type, triggered_by_user_id,
      parent_run_id, supersedes_run_id, reprocessing_job_id, error_details, completed_at)
    values (${r.orgId}, ${r.engine.name}, ${r.engine.version}, ${r.type}, ${r.contractId}, ${r.contractId}, ${r.competence},
      ${r.status}, ${tx.json(r.snapshot as never)}, ${r.hash}, ${r.rulesHash}, ${tx.json({ rounding: "ROUND_HALF_UP", money_scale: 2 })},
      ${trigger}, ${r.ctx.userId}, ${r.parentRunId}, ${r.supersedesRunId}, ${r.opts.reprocessingJobId ?? null},
      ${r.errorDetails ? tx.json(r.errorDetails as never) : null}, ${r.status === "FAILED" ? new Date() : null})
    returning id`;
  return row!.id as string;
}

async function supersede(tx: Tx, runId: string): Promise<void> {
  await tx`update app.calculation_runs set status = 'SUPERSEDED', superseded_at = now() where id = ${runId} and status = 'COMPLETED'`;
}

async function persistExpected(tx: Tx, orgId: string, runId: string, customerId: string, contractId: string, competence: string, r: ExpectedRevenueResult): Promise<string> {
  const [e] = await tx`
    insert into app.expected_revenue_events (organization_id, customer_id, contract_id, contract_version_id, competence, base_amount,
      variable_amount, adjustment_amount, discount_amount, expected_total, calculation_run_id)
    values (${orgId}, ${customerId}, ${contractId}, ${r.contractVersionId}, ${competence}, ${r.baseAmount}, ${r.variableAmount},
      ${r.adjustmentAmount}, ${r.discountAmount}, ${r.expectedTotal}, ${runId})
    returning id`;
  for (const c of r.components) {
    const [row] = await tx`
      insert into app.expected_revenue_components (organization_id, expected_revenue_event_id, component_type, sort_order, description,
        quantity, unit, unit_price, amount, source_rule_id, source_operational_event_id, calculation_formula, calculation_metadata)
      values (${orgId}, ${e!.id}, ${c.componentType}, ${c.sortOrder}, ${c.description}, ${c.quantity}, ${c.unit}, ${c.unitPrice}, ${c.amount},
        ${c.sourceRuleId}, ${c.sourceOperationalEventId}, ${c.calculationFormula}, ${tx.json(c.calculationMetadata as never)})
      returning id`;
    if (c.sources.length) {
      await tx`insert into app.expected_revenue_component_sources ${tx(
        c.sources.map((s) => ({
          organization_id: orgId, component_id: row!.id, source_type: s.sourceType, role: s.role,
          rule_id: s.ruleId ?? null, operational_event_id: s.operationalEventId ?? null, quantity: s.quantity ?? null,
        })) as never,
      )}`;
    }
  }
  return e!.id as string;
}

async function collectEvidence(tx: Tx, orgId: string, expectedEventId: string, expectedRunId: string, recRunId: string, billingIds: string[]) {
  const components = await tx`select * from app.expected_revenue_components where expected_revenue_event_id = ${expectedEventId} order by sort_order`;
  const sources = await tx`select s.* from app.expected_revenue_component_sources s join app.expected_revenue_components c on c.id = s.component_id
                           where c.expected_revenue_event_id = ${expectedEventId}`;
  const ruleIds = [...new Set(sources.filter((s) => s.rule_id).map((s) => s.rule_id as string))];
  const eventIds = [...new Set(sources.filter((s) => s.operational_event_id).map((s) => s.operational_event_id as string))];
  const rules = ruleIds.length
    ? await tx`select r.*, d.file_name, d.id as doc_id from app.contract_rules r join app.contract_documents d on d.id = r.source_document_id
               where r.id in ${tx(ruleIds)} order by r.rule_type, r.id`
    : [];
  const events = eventIds.length ? await tx`select * from app.operational_events where id in ${tx(eventIds)} order by event_date nulls last, id` : [];
  const bills = billingIds.length ? await tx`select * from app.billing_events where id in ${tx(billingIds)} order by billing_date, id` : [];
  const [ere] = await tx`select * from app.expected_revenue_events where id = ${expectedEventId}`;

  const rows: Array<Record<string, unknown>> = [];
  let order = 0;
  const push = (r: Record<string, unknown>) => rows.push({ organization_id: orgId, sort_order: order++, entity_id: null,
    source_document_id: null, source_import_id: null, source_import_row_id: null, source_rule_id: null, source_operational_event_id: null,
    source_billing_event_id: null, source_component_id: null, source_calculation_run_id: null, page_number: null, text_excerpt: null, ...r });

  for (const docId of [...new Set(rules.map((r) => r.doc_id as string))]) {
    const r = rules.find((x) => x.doc_id === docId)!;
    push({ evidence_type: "CONTRACT_DOCUMENT", entity_type: "contract_documents", entity_id: docId, source_document_id: docId, description: `Documento: ${r.file_name}` });
  }
  for (const r of rules) {
    const label = RULE_TYPE_LABELS[r.rule_type as RuleType] ?? r.rule_type;
    const value = r.rule_type === "FIXED_MONTHLY_FEE" || r.rule_type === "DISCOUNT_FIXED" || r.rule_type === "EXCESS_UNIT_PRICE"
      ? formatBRL(r.numeric_value) + (r.unit ? `/${UNIT_LABELS[r.unit] ?? r.unit}` : "")
      : `${formatQuantity(r.numeric_value)} ${UNIT_LABELS[r.unit] ?? r.unit ?? ""}`.trim();
    push({ evidence_type: "CONTRACT_RULE", entity_type: "contract_rules", entity_id: r.id, source_rule_id: r.id, source_document_id: r.doc_id,
      page_number: r.source_page, text_excerpt: r.source_text, description: `Regra ativa — ${label}: ${value} (${r.file_name}, p. ${r.source_page ?? "?"})` });
  }
  for (const e of events) {
    push({ evidence_type: "OPERATIONAL_EVENT", entity_type: "operational_events", entity_id: e.id, source_operational_event_id: e.id,
      source_import_id: e.source_import_id, source_import_row_id: e.source_import_row_id,
      description: `Evento operacional: ${formatQuantity(e.quantity)} ${UNIT_LABELS[e.unit] ?? e.unit} (${e.event_type})${e.description ? " — " + String(e.description).slice(0, 200) : ""}` });
  }
  for (const c of components) {
    push({ evidence_type: "CALCULATION_COMPONENT", entity_type: "expected_revenue_components", entity_id: c.id, source_component_id: c.id,
      description: `${c.description}: ${c.calculation_formula} ⇒ ${formatBRL(c.amount)}` });
  }
  push({ evidence_type: "EXPECTED_REVENUE", entity_type: "expected_revenue_events", entity_id: expectedEventId, source_calculation_run_id: expectedRunId,
    description: `Receita esperada: ${formatBRL(ere!.expected_total)}` });
  if (bills.length === 0) {
    push({ evidence_type: "NO_BILLING_FOUND", entity_type: "billing_events", description: "Nenhum evento de faturamento ativo encontrado para o cliente/contrato na competência" });
  }
  for (const b of bills) {
    push({ evidence_type: "BILLING_EVENT", entity_type: "billing_events", entity_id: b.id, source_billing_event_id: b.id,
      source_import_id: b.source_import_id, source_import_row_id: b.source_import_row_id,
      description: `Faturamento${b.document_number ? " NF " + b.document_number : ""} em ${b.billing_date}: ${formatBRL(b.amount)}` });
  }
  push({ evidence_type: "CALCULATION_RUN", entity_type: "calculation_runs", entity_id: expectedRunId, source_calculation_run_id: expectedRunId, description: `Cálculo de receita esperada (${EXPECTED_REVENUE_ENGINE.name})` });
  push({ evidence_type: "CALCULATION_RUN", entity_type: "calculation_runs", entity_id: recRunId, source_calculation_run_id: recRunId, description: `Reconciliação (${RECONCILIATION_ENGINE.name})` });
  // Métricas de confiança separadas (CONFIDENCE_MODEL)
  const checks = [
    ...rules.map((r) => r.source_verified === true && r.source_page !== null),
    ...events.map((e) => e.source_type === "MANUAL_ENTRY" || e.source_import_row_id !== null),
    ...(bills.length ? bills.map((b) => b.source_type === "MANUAL_ENTRY" || b.source_import_row_id !== null) : [true]),
    true,
  ];
  const completeness = (checks.filter(Boolean).length / checks.length).toFixed(4);
  const minOf = (vals: Array<string | null>) => {
    const v = vals.filter((x): x is string => x !== null).sort((a, b) => Number(a) - Number(b));
    return v[0] ?? null;
  };
  return {
    rows,
    evidenceCompleteness: completeness,
    extractionConfidence: minOf(rules.map((r) => (r.extraction_confidence as string | null) ?? null)),
    entityMatchConfidence: minOf([...events, ...bills].map((x) => (x.entity_match_confidence as string | null) ?? null)),
  };
}

export async function runRevenueAssurance(ctx: OrgContext, contractIdInput: string, competenceInput: string, opts: PipelineOptions = {}): Promise<PipelineResult> {
  requirePermission(ctx, "calculations.run");
  const contractId = assertUuid(contractIdInput, "contrato");
  let competence: Competence;
  try {
    competence = asCompetence(competenceInput);
  } catch {
    throw invalid("Competência inválida");
  }
  const engines = opts.engines ?? DEFAULT_ENGINES;

  // Autorização + visibilidade via RLS antes de qualquer escrita de sistema.
  await userTx(ctx, async (tx) => {
    const [k] = await tx`select id from app.contracts where id = ${contractId} and organization_id = ${ctx.orgId}`;
    if (!k) throw notFound("Contrato");
  });

  const started = Date.now();
  type FailureSnap = { snapshot: unknown; hash: string; parent: string | null; type: "EXPECTED_REVENUE" | "RECONCILIATION" };
  let failureSnapshot = null as FailureSnap | null;
  let expectedFailureSnapshot = null as FailureSnap | null;
  try {
    const result = await systemTx(ctx, async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`calc:${ctx.orgId}:${contractId}:${competence}`}, 0))`;
      await setAuditIntent(tx, opts.trigger === "REPROCESSING" ? "calculation.reprocess" : "calculation.run");
      const L = await loadInputs(tx, ctx.orgId, contractId, competence);
      const out: PipelineResult = {
        contractId, competence, findingId: null,
        expected: { status: "SKIPPED", runId: null }, reconciliation: { status: "SKIPPED", runId: null },
      };

      // ---------------- Estágio 1: Expected Revenue ----------------
      const expectedSnapshot = { engine: { name: engines.expected.name, version: engines.expected.version }, input: L.expectedInput };
      const expectedHash = hashCanonical(expectedSnapshot);
      const rulesHash = hashCanonical(L.expectedInput.rules);
      failureSnapshot = { snapshot: expectedSnapshot, hash: expectedHash, parent: null, type: "EXPECTED_REVENUE" };
      expectedFailureSnapshot = failureSnapshot;
      const curExp = await currentRun(tx, ctx.orgId, "EXPECTED_REVENUE", contractId, competence);
      const curRec = await currentRun(tx, ctx.orgId, "RECONCILIATION", contractId, competence);

      let expRunId: string;
      let ere: Record<string, unknown>;
      let expectedIsNew = false;
      if (curExp && curExp.engine_version === engines.expected.version && curExp.input_snapshot_hash === expectedHash) {
        expRunId = curExp.id;
        [ere] = (await tx`select * from app.expected_revenue_events where calculation_run_id = ${expRunId}`) as unknown as [Record<string, unknown>];
        out.expected = { status: "REUSED", runId: expRunId, expectedTotal: ere.expected_total as string };
      } else {
        const outcome = engines.expected.calculate(L.expectedInput);
        if (outcome.status === "NOT_APPLICABLE") {
          out.expected = { status: "NOT_APPLICABLE", runId: null, code: outcome.code, message: outcome.message };
          return out;
        }
        if (outcome.status === "NEEDS_REVIEW") {
          const runId = await insertRun(tx, { orgId: ctx.orgId, engine: engines.expected, type: "EXPECTED_REVENUE", contractId, competence,
            status: "FAILED", snapshot: expectedSnapshot, hash: expectedHash, rulesHash, parentRunId: null, supersedesRunId: null, ctx, opts,
            errorDetails: { kind: "NEEDS_REVIEW", code: outcome.code, message: outcome.message, details: outcome.details ?? null } });
          out.expected = { status: "NEEDS_REVIEW", runId, code: outcome.code, message: outcome.message };
          return out;
        }
        expRunId = await insertRun(tx, { orgId: ctx.orgId, engine: engines.expected, type: "EXPECTED_REVENUE", contractId, competence,
          status: "RUNNING", snapshot: expectedSnapshot, hash: expectedHash, rulesHash, parentRunId: null, supersedesRunId: curExp?.id ?? null, ctx, opts });
        const ereId = await persistExpected(tx, ctx.orgId, expRunId, L.contract.customer_id as string, contractId, competence, outcome.result);
        if (curExp) await supersede(tx, curExp.id);
        // A reconciliação corrente se apoiava no expected substituído: deixa de ser corrente.
        if (curRec) await supersede(tx, curRec.id);
        await tx`update app.calculation_runs set status = 'COMPLETED', completed_at = now(),
                 result_summary = ${tx.json({ expected_total: outcome.result.expectedTotal, base_amount: outcome.result.baseAmount,
                   variable_amount: outcome.result.variableAmount, discount_amount: outcome.result.discountAmount,
                   components: outcome.result.components.length, warnings: outcome.result.warnings })}
                 where id = ${expRunId}`;
        [ere] = (await tx`select * from app.expected_revenue_events where id = ${ereId}`) as unknown as [Record<string, unknown>];
        expectedIsNew = true;
        out.expected = { status: "CREATED", runId: expRunId, expectedTotal: outcome.result.expectedTotal };
      }

      // ---------------- Estágio 2: Reconciliação ----------------
      const recInput: ReconciliationInput = {
        competence,
        contractId,
        expected: {
          expectedRevenueEventId: ere.id as string,
          baseAmount: ere.base_amount as string,
          variableAmount: ere.variable_amount as string,
          adjustmentAmount: ere.adjustment_amount as string,
          discountAmount: ere.discount_amount as string,
          expectedTotal: ere.expected_total as string,
        },
        billingEvents: L.billing.map((b) => ({ id: b.id as string, amount: b.amount as string, contractId: (b.contract_id as string | null) ?? null, documentNumber: (b.document_number as string | null) ?? null })),
        otherContractsCoveringCompetence: L.otherContracts,
        materiality: L.materiality,
      };
      const recSnapshot = { engine: { name: engines.reconciliation.name, version: engines.reconciliation.version }, expected_run_id: expRunId, input: recInput };
      const recHash = hashCanonical(recSnapshot);
      failureSnapshot = { snapshot: recSnapshot, hash: recHash, parent: expRunId, type: "RECONCILIATION" };
      const liveRec = expectedIsNew ? null : curRec;
      if (liveRec && liveRec.parent_run_id === expRunId && liveRec.engine_version === engines.reconciliation.version && liveRec.input_snapshot_hash === recHash) {
        const [f] = await tx`select id from app.findings where calculation_run_id = ${liveRec.id}`;
        out.reconciliation = { status: "REUSED", runId: liveRec.id, outcome: liveRec.result_summary?.outcome, differenceAmount: liveRec.result_summary?.difference_amount };
        out.findingId = (f?.id as string) ?? null;
        return out;
      }
      const rec = engines.reconciliation.reconcile(recInput);
      if (rec.status === "NEEDS_REVIEW") {
        const runId = await insertRun(tx, { orgId: ctx.orgId, engine: engines.reconciliation, type: "RECONCILIATION", contractId, competence,
          status: "FAILED", snapshot: recSnapshot, hash: recHash, rulesHash: null, parentRunId: expRunId, supersedesRunId: null, ctx, opts,
          errorDetails: { kind: "NEEDS_REVIEW", code: rec.code, message: rec.message, details: rec.details ?? null } });
        out.reconciliation = { status: "NEEDS_REVIEW", runId, code: rec.code, message: rec.message };
        return out;
      }
      const recRunId = await insertRun(tx, { orgId: ctx.orgId, engine: engines.reconciliation, type: "RECONCILIATION", contractId, competence,
        status: "RUNNING", snapshot: recSnapshot, hash: recHash, rulesHash: null, parentRunId: expRunId, supersedesRunId: curRec?.id ?? null, ctx, opts });

      let findingId: string | null = null;
      if (rec.result.finding) {
        const prev = curRec ? await tx`select id from app.findings where calculation_run_id = ${curRec.id}` : [];
        const f = rec.result.finding;
        // Confiança e completude calculadas antes do INSERT: o finding é imutável depois de criado.
        const ev = await collectEvidence(tx, ctx.orgId, ere.id as string, expRunId, recRunId, rec.result.billingEventIds);
        const [row] = await tx`
          insert into app.findings (organization_id, customer_id, contract_id, contract_version_id, competence, finding_type, expected_amount,
            billed_amount, difference_amount, severity, status, explanation, calculation_run_id, expected_revenue_event_id, previous_finding_id,
            evidence_completeness, extraction_confidence, entity_match_confidence)
          values (${ctx.orgId}, ${L.contract.customer_id as string}, ${contractId}, ${ere.contract_version_id as string}, ${competence}, ${f.findingType},
            ${f.expectedAmount}, ${f.billedAmount}, ${f.differenceAmount}, ${f.severity}, 'OPEN', ${f.explanation}, ${recRunId}, ${ere.id as string},
            ${(prev[0]?.id as string) ?? null}, ${ev.evidenceCompleteness}, ${ev.extractionConfidence}, ${ev.entityMatchConfidence})
          returning id`;
        findingId = row!.id as string;
        await tx`insert into app.finding_evidence ${tx(ev.rows.map((r) => ({ ...r, finding_id: findingId })) as never)}`;
      }
      if (curRec && !expectedIsNew) await supersede(tx, curRec.id);
      await tx`update app.calculation_runs set status = 'COMPLETED', completed_at = now(),
               result_summary = ${tx.json({ outcome: rec.result.outcome, expected_total: recInput.expected.expectedTotal,
                 billed_amount: rec.result.billedAmount, difference_amount: rec.result.differenceAmount,
                 billing_event_ids: rec.result.billingEventIds, materiality: rec.result.materiality,
                 known_explanations_evaluated: rec.result.knownExplanationsEvaluated, finding_id: findingId } as never)}
               where id = ${recRunId}`;
      out.reconciliation = { status: "CREATED", runId: recRunId, outcome: rec.result.outcome, differenceAmount: rec.result.differenceAmount };
      out.findingId = findingId;
      return out;
    });
    logger.info("calculation.completed", { org: ctx.orgId, contract: contractId, competence, ms: Date.now() - started,
      expected: result.expected.status, reconciliation: result.reconciliation.status, finding: result.findingId,
      engines: { expected: engines.expected.version, reconciliation: engines.reconciliation.version } });
    return result;
  } catch (e) {
    if (e instanceof AppError) throw e;
    // Falha técnica (ex.: invariante violada no commit): nada foi publicado; registra run FAILED.
    logger.error("calculation.failed", { org: ctx.orgId, contract: contractId, competence, error: (e as Error).message.slice(0, 500) });
    const recSnap = failureSnapshot as FailureSnap | null;
    const expSnap = expectedFailureSnapshot as FailureSnap | null;
    if (recSnap || expSnap) {
      try {
        await systemTx(ctx, async (tx) => {
          // Se o run pai foi revertido junto (expected novo), a falha é registrada no estágio de expected revenue.
          const parent = recSnap?.parent ? (await tx`select id from app.calculation_runs where id = ${recSnap.parent}`)[0]?.id ?? null : null;
          const snap = recSnap && recSnap.type === "RECONCILIATION" && parent ? recSnap : expSnap;
          if (!snap) return;
          const engine = snap.type === "EXPECTED_REVENUE" ? engines.expected : engines.reconciliation;
          await insertRun(tx, { orgId: ctx.orgId, engine, type: snap.type, contractId, competence, status: "FAILED", snapshot: snap.snapshot,
            hash: snap.hash, rulesHash: null, parentRunId: snap.type === "RECONCILIATION" ? parent : null, supersedesRunId: null, ctx, opts,
            errorDetails: { kind: "TECHNICAL", code: /INVARIANT_VIOLATION/.test((e as Error).message) ? "INVARIANT_VIOLATION" : "ERROR", message: (e as Error).message.slice(0, 1000) } });
        });
      } catch (inner) {
        logger.error("calculation.failure_record_failed", { error: (inner as Error).message.slice(0, 300) });
      }
    }
    throw new AppError("CALCULATION_FAILED", "O cálculo falhou e nenhum resultado financeiro foi publicado. Detalhes técnicos registrados.", 500);
  }
}

/** Competências com dados (eventos, faturamento ou runs) para um contrato — base do escopo de reprocessamento. */
export async function competencesWithData(tx: Tx, orgId: string, contractId: string): Promise<string[]> {
  const rows = await tx`
    select competence from app.calculation_runs where organization_id = ${orgId} and contract_id = ${contractId}
    union select e.competence from app.operational_events e join app.contracts k on k.customer_id = e.customer_id
      where k.id = ${contractId} and e.organization_id = ${orgId} and e.status = 'ACTIVE'
    union select b.competence from app.billing_events b join app.contracts k on k.customer_id = b.customer_id
      where k.id = ${contractId} and b.organization_id = ${orgId} and b.status = 'ACTIVE'
    order by 1`;
  return rows.map((r) => r.competence as string);
}
