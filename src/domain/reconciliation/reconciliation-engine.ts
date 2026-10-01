import { formatCompetence, type Competence } from "../competence";
import { Decimal, dec, formatBRL, sum, toMoneyString } from "../money/decimal";
import { checkFindingInvariant } from "../revenue/invariants";
import { evaluateMateriality, type MaterialityEvaluation, type MaterialityPolicy } from "./materiality";

/**
 * RECONCILIATION ENGINE — Expected vs Billed (sem RECEIVED no MVP). Determinístico.
 * Detecta; nunca classifica (o finding nasce OPEN — DETECTION_VS_CLASSIFICATION).
 */
export const RECONCILIATION_ENGINE = { name: "reconciliation_engine", version: "1.0.0" } as const;

export type FindingType = "CONSUMO_EXCEDENTE_NAO_FATURADO" | "COBRANCA_ABAIXO_DO_CONTRATO" | "CLIENTE_ATIVO_SEM_FATURAMENTO";
export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export const FINDING_TYPE_LABELS: Record<FindingType, string> = {
  CONSUMO_EXCEDENTE_NAO_FATURADO: "Consumo excedente não faturado",
  COBRANCA_ABAIXO_DO_CONTRATO: "Cobrança abaixo do contrato",
  CLIENTE_ATIVO_SEM_FATURAMENTO: "Cliente ativo sem faturamento",
};

export interface ReconciliationInput {
  competence: Competence;
  contractId: string;
  expected: {
    expectedRevenueEventId: string;
    baseAmount: string;
    variableAmount: string;
    adjustmentAmount: string;
    discountAmount: string;
    expectedTotal: string;
  };
  /** Eventos ACTIVE do cliente na competência, deste contrato ou sem contrato. */
  billingEvents: Array<{ id: string; amount: string; contractId: string | null; documentNumber: string | null }>;
  otherContractsCoveringCompetence: number;
  materiality: MaterialityPolicy;
}

export type ReconciliationOutcomeCode =
  | "NO_DIVERGENCE"
  | "BELOW_MATERIALITY"
  | "OVERBILLED_NOT_EVALUATED"
  | "FINDING";

export interface FindingCandidate {
  findingType: FindingType;
  severity: Severity;
  expectedAmount: string;
  billedAmount: string;
  differenceAmount: string;
  explanation: string;
}

export interface ReconciliationResult {
  outcome: ReconciliationOutcomeCode;
  billedAmount: string;
  differenceAmount: string;
  billingEventIds: string[];
  materiality: MaterialityEvaluation;
  knownExplanationsEvaluated: string[];
  finding: FindingCandidate | null;
}

export type ReconciliationOutcome =
  | { status: "RECONCILED"; result: ReconciliationResult }
  | { status: "NEEDS_REVIEW"; code: string; message: string; details?: Record<string, unknown> };

/** Severidade pela razão diferença/esperado (ADR-019). */
export function severityFor(difference: Decimal, expected: Decimal): Severity {
  if (expected.isZero()) return "CRITICAL";
  const r = difference.dividedBy(expected);
  if (r.lessThan("0.05")) return "LOW";
  if (r.lessThan("0.15")) return "MEDIUM";
  if (r.lessThan("0.5")) return "HIGH";
  return "CRITICAL";
}

export function reconcile(input: ReconciliationInput): ReconciliationOutcome {
  const unattributed = input.billingEvents.filter((b) => b.contractId === null);
  if (unattributed.length > 0 && input.otherContractsCoveringCompetence > 0) {
    return {
      status: "NEEDS_REVIEW",
      code: "AMBIGUOUS_BILLING_ATTRIBUTION",
      message: "Faturamento sem contrato para cliente com mais de um contrato vigente; vincule o contrato no import",
      details: { billing_event_ids: unattributed.map((b) => b.id) },
    };
  }
  const foreign = input.billingEvents.filter((b) => b.contractId !== null && b.contractId !== input.contractId);
  if (foreign.length > 0) {
    return { status: "NEEDS_REVIEW", code: "FOREIGN_BILLING", message: "Faturamento de outro contrato fornecido ao motor" };
  }

  const events = [...input.billingEvents].sort((a, b) => a.id.localeCompare(b.id));
  const expected = dec(input.expected.expectedTotal);
  const billed = sum(events.map((b) => b.amount));
  const difference = expected.minus(billed);
  const materiality = evaluateMateriality(input.materiality, difference.toFixed(2), expected.toFixed(2));
  const base = {
    billedAmount: toMoneyString(billed),
    differenceAmount: toMoneyString(difference),
    billingEventIds: events.map((e) => e.id),
    materiality,
    // Explicações conhecidas modeladas no MVP: desconto fixo autorizado (já abatido no esperado).
    knownExplanationsEvaluated: dec(input.expected.discountAmount).isZero() ? [] : ["DISCOUNT_FIXED"],
  };

  if (difference.isZero()) return { status: "RECONCILED", result: { ...base, outcome: "NO_DIVERGENCE", finding: null } };
  if (difference.isNegative()) {
    // COBRANCA_ACIMA_DO_CONTRATADO está fora do MVP: registrado, não vira finding.
    return { status: "RECONCILED", result: { ...base, outcome: "OVERBILLED_NOT_EVALUATED", finding: null } };
  }
  if (!materiality.material) return { status: "RECONCILED", result: { ...base, outcome: "BELOW_MATERIALITY", finding: null } };

  const variable = dec(input.expected.variableAmount);
  const baseNet = dec(input.expected.baseAmount).plus(input.expected.adjustmentAmount).minus(input.expected.discountAmount);
  let findingType: FindingType;
  if (billed.isZero()) findingType = "CLIENTE_ATIVO_SEM_FATURAMENTO";
  else if (variable.greaterThan(0) && billed.greaterThanOrEqualTo(baseNet)) findingType = "CONSUMO_EXCEDENTE_NAO_FATURADO";
  else findingType = "COBRANCA_ABAIXO_DO_CONTRATO";

  const label = formatCompetence(input.competence);
  const docs = events.map((e) => e.documentNumber).filter((d): d is string => !!d);
  const billedText = billed.isZero()
    ? `nenhum faturamento encontrado para a competência ${label}`
    : `faturado ${formatBRL(billed)} na competência ${label}${docs.length ? ` (documento(s) ${docs.join(", ")})` : ""}`;
  const parts = [`base ${formatBRL(input.expected.baseAmount)}`];
  if (!variable.isZero()) parts.push(`variável ${formatBRL(variable)}`);
  if (!dec(input.expected.discountAmount).isZero()) parts.push(`desconto autorizado −${formatBRL(input.expected.discountAmount)}`);
  const lead =
    findingType === "CLIENTE_ATIVO_SEM_FATURAMENTO"
      ? `Possível receita não faturada: ${formatBRL(difference)}. Contrato ativo sem faturamento identificado.`
      : `Possível receita não faturada: ${formatBRL(difference)}.`;
  const explanation = `${lead} Esperado ${formatBRL(expected)} (${parts.join(" + ")}); ${billedText}. Necessita revisão humana.`;

  const finding: FindingCandidate = {
    findingType,
    severity: severityFor(difference, expected),
    expectedAmount: toMoneyString(expected),
    billedAmount: toMoneyString(billed),
    differenceAmount: toMoneyString(difference),
    explanation,
  };
  const violations = checkFindingInvariant(finding);
  if (violations.length > 0) throw new Error(`INVARIANT_VIOLATION: ${violations.join("; ")}`);
  return { status: "RECONCILED", result: { ...base, outcome: "FINDING", finding } };
}
