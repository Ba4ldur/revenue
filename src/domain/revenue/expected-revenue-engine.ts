import { monthCoverage, formatCompetence, type Competence } from "../competence";
import {
  ENGINE_BLOCKING_RULE_TYPES,
  ENGINE_SUPPORTED_RULE_TYPES,
  INFORMATIONAL_RULE_TYPES,
  UNIT_LABELS,
  type RuleType,
} from "../contracts/rules";
import {
  Decimal,
  MONEY_SCALE,
  QUANTITY_SCALE,
  ROUNDING_MODE_NAME,
  UNIT_PRICE_SCALE,
  ZERO,
  dec,
  max,
  roundMoney,
  sum,
  toMoneyString,
  toScale6String,
} from "../money/decimal";
import { checkExpectedRevenueInvariants } from "./invariants";

/**
 * EXPECTED REVENUE ENGINE — 100% determinístico. Pergunta: "quanto deveria ter sido faturado?"
 * Mesma entrada + mesma versão ⇒ mesma saída (sem relógio, sem aleatoriedade, sem I/O).
 * Alterações que mudem resultado financeiro exigem nova versão (ADR-007).
 */
export const EXPECTED_REVENUE_ENGINE = { name: "expected_revenue_engine", version: "1.0.0" } as const;

export interface EngineContract {
  id: string;
  customerId: string;
  status: "DRAFT" | "ACTIVE" | "SUSPENDED" | "TERMINATED";
  startDate: string;
  endDate: string | null;
}

export interface EngineVersion {
  id: string;
  versionNumber: number;
  status: "DRAFT" | "ACTIVE" | "SUPERSEDED";
  validFrom: string;
  validUntil: string | null;
}

export interface EngineRule {
  id: string;
  versionId: string;
  ruleType: RuleType;
  status: string;
  numericValue: string | null;
  unit: string | null;
  validFrom: string;
  validUntil: string | null;
}

export interface EngineOperationalEvent {
  id: string;
  contractId: string | null;
  eventType: string;
  quantity: string;
  unit: string;
}

export interface ExpectedRevenueInput {
  competence: Competence;
  contract: EngineContract;
  versions: EngineVersion[];
  rules: EngineRule[];
  /** Eventos ACTIVE do cliente na competência, vinculados a este contrato ou sem contrato. */
  operationalEvents: EngineOperationalEvent[];
  /** Outros contratos do mesmo cliente que cobrem a competência (atribuição ambígua). */
  otherContractsCoveringCompetence: number;
}

export type ComponentType = "BASE" | "EXCESS" | "ADDITIONAL_SERVICE" | "ADJUSTMENT" | "DISCOUNT" | "OTHER";

export interface ComponentSource {
  sourceType: "CONTRACT_RULE" | "OPERATIONAL_EVENT";
  role: "FEE" | "INCLUDED_QUANTITY" | "UNIT_PRICE" | "USAGE" | "DISCOUNT";
  ruleId?: string;
  operationalEventId?: string;
  quantity?: string;
}

export interface ExpectedRevenueComponentResult {
  componentType: ComponentType;
  sortOrder: number;
  description: string;
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  amount: string;
  sourceRuleId: string | null;
  sourceOperationalEventId: string | null;
  calculationFormula: string;
  calculationMetadata: Record<string, unknown>;
  sources: ComponentSource[];
}

export interface ExpectedRevenueResult {
  contractVersionId: string;
  baseAmount: string;
  variableAmount: string;
  adjustmentAmount: string;
  discountAmount: string;
  expectedTotal: string;
  components: ExpectedRevenueComponentResult[];
  warnings: string[];
}

export type EngineOutcome =
  | { status: "CALCULATED"; result: ExpectedRevenueResult }
  | { status: "NOT_APPLICABLE"; code: string; message: string }
  | { status: "NEEDS_REVIEW"; code: string; message: string; details?: Record<string, unknown> };

function needsReview(code: string, message: string, details?: Record<string, unknown>): EngineOutcome {
  return { status: "NEEDS_REVIEW", code, message, details };
}

const PRECISION = { quantity: QUANTITY_SCALE, unit_price: UNIT_PRICE_SCALE, amount: MONEY_SCALE };

export function calculateExpectedRevenue(input: ExpectedRevenueInput): EngineOutcome {
  const { competence, contract } = input;
  const label = formatCompetence(competence);

  // 1. Aplicabilidade do contrato -------------------------------------------------------
  if (contract.status === "DRAFT") {
    return { status: "NOT_APPLICABLE", code: "CONTRACT_DRAFT", message: "Contrato em rascunho" };
  }
  if (contract.status === "SUSPENDED") {
    return { status: "NOT_APPLICABLE", code: "CONTRACT_SUSPENDED", message: "Contrato suspenso" };
  }
  const contractCoverage = monthCoverage(competence, contract.startDate, contract.endDate);
  if (contractCoverage === "NONE") {
    return { status: "NOT_APPLICABLE", code: "OUTSIDE_CONTRACT_TERM", message: `Contrato não vigente em ${label}` };
  }
  if (contractCoverage === "PARTIAL") {
    return needsReview("PARTIAL_MONTH_CONTRACT", `Contrato cobre apenas parte de ${label}; pró-rata não é suportado na versão 1.0.0`);
  }

  // 2. Atribuição de eventos ------------------------------------------------------------
  const unattributed = input.operationalEvents.filter((e) => e.contractId === null);
  if (unattributed.length > 0 && input.otherContractsCoveringCompetence > 0) {
    return needsReview(
      "AMBIGUOUS_EVENT_ATTRIBUTION",
      "Há eventos operacionais sem contrato para cliente com mais de um contrato vigente; vincule o contrato no import",
      { event_ids: unattributed.map((e) => e.id) },
    );
  }
  const foreign = input.operationalEvents.filter((e) => e.contractId !== null && e.contractId !== contract.id);
  if (foreign.length > 0) {
    return needsReview("FOREIGN_EVENTS", "Eventos de outro contrato foram fornecidos ao motor", { event_ids: foreign.map((e) => e.id) });
  }

  // 3. Versão vigente: exatamente uma versão ACTIVE cobrindo o mês inteiro ----------------
  const touching = input.versions.filter(
    (v) => v.status === "ACTIVE" && monthCoverage(competence, v.validFrom, v.validUntil) !== "NONE",
  );
  if (touching.length === 0) {
    return needsReview("NO_ACTIVE_VERSION", `Nenhuma versão contratual ativa em ${label}`);
  }
  if (touching.length > 1) {
    return needsReview("MID_MONTH_VERSION_CHANGE", `Mais de uma versão vigente em ${label}; pró-rata não suportado`, {
      version_ids: touching.map((v) => v.id),
    });
  }
  const version = touching[0]!;
  if (monthCoverage(competence, version.validFrom, version.validUntil) !== "FULL") {
    return needsReview("PARTIAL_VERSION_COVERAGE", `Versão ${version.versionNumber} cobre apenas parte de ${label}`);
  }

  // 4. Regras ATIVAS da versão que tocam o mês -----------------------------------------
  const rules = input.rules.filter(
    (r) => r.status === "ACTIVE" && r.versionId === version.id && monthCoverage(competence, r.validFrom, r.validUntil) !== "NONE",
  );
  const partial = rules.filter((r) => monthCoverage(competence, r.validFrom, r.validUntil) === "PARTIAL");
  if (partial.length > 0) {
    return needsReview("PARTIAL_RULE_COVERAGE", "Regra com vigência parcial no mês; pró-rata não suportado", {
      rule_ids: partial.map((r) => r.id),
    });
  }
  const blocking = rules.filter((r) => ENGINE_BLOCKING_RULE_TYPES.has(r.ruleType));
  if (blocking.length > 0) {
    return needsReview(
      "UNSUPPORTED_RULE_TYPE",
      `Regra monetária ativa não suportada pela versão ${EXPECTED_REVENUE_ENGINE.version}: ${[...new Set(blocking.map((r) => r.ruleType))].join(", ")}`,
      { rule_ids: blocking.map((r) => r.id) },
    );
  }
  const unknown = rules.filter((r) => !ENGINE_SUPPORTED_RULE_TYPES.has(r.ruleType) && !INFORMATIONAL_RULE_TYPES.has(r.ruleType));
  if (unknown.length > 0) {
    return needsReview("UNKNOWN_RULE_TYPE", "Tipo de regra desconhecido", { rule_ids: unknown.map((r) => r.id) });
  }

  const byType = (t: RuleType) => rules.filter((r) => r.ruleType === t).sort((a, b) => a.id.localeCompare(b.id));
  const fees = byType("FIXED_MONTHLY_FEE");
  const included = byType("INCLUDED_QUANTITY");
  const prices = byType("EXCESS_UNIT_PRICE");
  const discounts = byType("DISCOUNT_FIXED");

  if (fees.length > 1 || discounts.length > 1) {
    return needsReview("DUPLICATE_RULES", "Mais de uma mensalidade/desconto ativo no mesmo período");
  }
  if (fees.length === 0 && included.length === 0 && prices.length === 0) {
    return needsReview("NO_MONETARY_RULES", `Nenhuma regra monetária ativa na versão ${version.versionNumber}`);
  }
  for (const r of [...fees, ...included, ...prices, ...discounts]) {
    if (r.numericValue === null) return needsReview("RULE_WITHOUT_VALUE", "Regra ativa sem valor numérico", { rule_id: r.id });
  }

  const components: ExpectedRevenueComponentResult[] = [];
  const warnings: string[] = [];
  let order = 0;

  // 5. BASE -----------------------------------------------------------------------------
  const fee = fees[0];
  if (fee) {
    const value = dec(fee.numericValue!);
    const amount = roundMoney(value);
    components.push({
      componentType: "BASE",
      sortOrder: order++,
      description: `Mensalidade fixa (versão ${version.versionNumber})`,
      quantity: "1.000000",
      unit: "MONTH",
      unitPrice: toScale6String(value),
      amount: toMoneyString(amount),
      sourceRuleId: fee.id,
      sourceOperationalEventId: null,
      calculationFormula: `1 × ${value.toFixed(2)} = ${amount.toFixed(2)}`,
      calculationMetadata: {
        engine: EXPECTED_REVENUE_ENGINE,
        inputs: { fixed_monthly_fee: value.toFixed() },
        precision: PRECISION,
        rounding: { mode: ROUNDING_MODE_NAME, scale: MONEY_SCALE, applied_to: "amount" },
        result: amount.toFixed(2),
      },
      sources: [{ sourceType: "CONTRACT_RULE", role: "FEE", ruleId: fee.id }],
    });
  }

  // 6. EXCESS por unidade -------------------------------------------------------------------
  const units = [...new Set([...included.map((r) => r.unit!), ...prices.map((r) => r.unit!)])].sort();
  for (const unit of units) {
    const inc = included.filter((r) => r.unit === unit);
    const prc = prices.filter((r) => r.unit === unit);
    if (inc.length > 1 || prc.length > 1) {
      return needsReview("DUPLICATE_RULES", `Mais de uma regra de franquia/preço ativa para a unidade ${unit}`);
    }
    const events = input.operationalEvents
      .filter((e) => e.unit === unit)
      .sort((a, b) => a.id.localeCompare(b.id));
    const usage = sum(events.map((e) => e.quantity));
    const incRule = inc[0];
    const prcRule = prc[0];

    if (!incRule && prcRule) {
      return needsReview(
        "MISSING_INCLUDED_QUANTITY",
        `Preço de excedente por ${unit} sem franquia ativa; franquia zero deve ser registrada explicitamente`,
        { rule_id: prcRule.id },
      );
    }
    const includedQty = dec(incRule!.numericValue!);
    if (!prcRule) {
      if (usage.greaterThan(includedQty)) {
        return needsReview(
          "MISSING_EXCESS_PRICE",
          `Uso de ${usage.toFixed()} ${unit} excede a franquia de ${includedQty.toFixed()} e não há preço de excedente ativo`,
          { rule_id: incRule!.id },
        );
      }
      warnings.push(`Franquia de ${unit} sem preço de excedente; uso dentro da franquia.`);
      continue;
    }
    const unitPrice = dec(prcRule.numericValue!);
    const excess = max(ZERO, usage.minus(includedQty));
    const raw = excess.times(unitPrice);
    const amount = roundMoney(raw);
    if (events.length === 0) warnings.push(`Nenhum evento operacional em ${unit} para a competência; excedente considerado zero.`);

    components.push({
      componentType: "EXCESS",
      sortOrder: order++,
      description: `Excedente (${UNIT_LABELS[unit] ?? unit}): uso ${usage.toFixed()} − franquia ${includedQty.toFixed()}`,
      quantity: toScale6String(excess),
      unit,
      unitPrice: toScale6String(unitPrice),
      amount: toMoneyString(amount),
      sourceRuleId: prcRule.id,
      sourceOperationalEventId: events.length === 1 ? events[0]!.id : null,
      calculationFormula:
        `max(0, ${usage.toFixed()} − ${includedQty.toFixed()}) = ${excess.toFixed()}; ` +
        `${excess.toFixed()} × ${unitPrice.toFixed(2)} = ${amount.toFixed(2)}`,
      calculationMetadata: {
        engine: EXPECTED_REVENUE_ENGINE,
        inputs: {
          usage: usage.toFixed(),
          included_quantity: includedQty.toFixed(),
          excess_unit_price: unitPrice.toFixed(),
          operational_event_count: events.length,
        },
        intermediate: { excess_quantity: excess.toFixed(), unrounded_amount: raw.toFixed() },
        precision: PRECISION,
        rounding: { mode: ROUNDING_MODE_NAME, scale: MONEY_SCALE, applied_to: "amount" },
        result: amount.toFixed(2),
      },
      sources: [
        { sourceType: "CONTRACT_RULE", role: "INCLUDED_QUANTITY", ruleId: incRule!.id },
        { sourceType: "CONTRACT_RULE", role: "UNIT_PRICE", ruleId: prcRule.id },
        ...events.map((e) => ({
          sourceType: "OPERATIONAL_EVENT" as const,
          role: "USAGE" as const,
          operationalEventId: e.id,
          quantity: toScale6String(dec(e.quantity)),
        })),
      ],
    });
  }

  const orphanUnits = [...new Set(input.operationalEvents.map((e) => e.unit))].filter((u) => !units.includes(u));
  for (const u of orphanUnits.sort()) warnings.push(`Eventos em ${u} sem regra contratual ativa foram desconsiderados.`);

  const base = sum(components.filter((c) => c.componentType === "BASE").map((c) => c.amount));
  const variable = sum(components.filter((c) => c.componentType === "EXCESS").map((c) => c.amount));

  // 7. DISCOUNT ----------------------------------------------------------------------------
  const discountRule = discounts[0];
  let discount = ZERO;
  if (discountRule) {
    discount = roundMoney(dec(discountRule.numericValue!));
    if (discount.greaterThan(base.plus(variable))) {
      return needsReview("DISCOUNT_EXCEEDS_GROSS", "Desconto autorizado maior que a receita bruta esperada", { rule_id: discountRule.id });
    }
    components.push({
      componentType: "DISCOUNT",
      sortOrder: order++,
      description: "Desconto fixo autorizado em contrato",
      quantity: null,
      unit: null,
      unitPrice: null,
      amount: toMoneyString(discount.negated()),
      sourceRuleId: discountRule.id,
      sourceOperationalEventId: null,
      calculationFormula: `−${discount.toFixed(2)}`,
      calculationMetadata: {
        engine: EXPECTED_REVENUE_ENGINE,
        inputs: { discount_fixed: dec(discountRule.numericValue!).toFixed() },
        precision: PRECISION,
        rounding: { mode: ROUNDING_MODE_NAME, scale: MONEY_SCALE, applied_to: "amount" },
        result: discount.negated().toFixed(2),
      },
      sources: [{ sourceType: "CONTRACT_RULE", role: "DISCOUNT", ruleId: discountRule.id }],
    });
  }

  const adjustment = new Decimal(0);
  const total = base.plus(variable).plus(adjustment).minus(discount);

  const result: ExpectedRevenueResult = {
    contractVersionId: version.id,
    baseAmount: toMoneyString(base),
    variableAmount: toMoneyString(variable),
    adjustmentAmount: toMoneyString(adjustment),
    discountAmount: toMoneyString(discount),
    expectedTotal: toMoneyString(total),
    components,
    warnings,
  };

  const violations = checkExpectedRevenueInvariants(result);
  if (violations.length > 0) {
    // Nunca deveria acontecer: falha técnica, resultado não é publicado.
    throw new InvariantViolationError(violations);
  }
  return { status: "CALCULATED", result };
}

export class InvariantViolationError extends Error {
  constructor(readonly violations: string[]) {
    super(`INVARIANT_VIOLATION: ${violations.join("; ")}`);
    this.name = "InvariantViolationError";
  }
}
