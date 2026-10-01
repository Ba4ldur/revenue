import { asCompetence } from "@/domain/competence";
import type { EngineRule, ExpectedRevenueInput } from "@/domain/revenue/expected-revenue-engine";
import type { MaterialityPolicy } from "@/domain/reconciliation/materiality";

export const V1 = "00000000-0000-4000-8000-000000000001";
export const V2 = "00000000-0000-4000-8000-000000000002";
export const CONTRACT = "00000000-0000-4000-8000-0000000000c1";

export function rule(id: string, ruleType: EngineRule["ruleType"], value: string, unit: string | null = null, extra: Partial<EngineRule> = {}): EngineRule {
  return { id, versionId: V1, ruleType, status: "ACTIVE", numericValue: value, unit, validFrom: "2026-01-01", validUntil: null, ...extra };
}

export function scenario(opts: {
  fee?: string;
  included?: string;
  price?: string;
  discount?: string;
  usage?: string[];
  competence?: string;
  extraRules?: EngineRule[];
}): ExpectedRevenueInput {
  const rules: EngineRule[] = [];
  if (opts.fee) rules.push(rule("r-fee", "FIXED_MONTHLY_FEE", opts.fee));
  if (opts.included) rules.push(rule("r-inc", "INCLUDED_QUANTITY", opts.included, "HOUR"));
  if (opts.price) rules.push(rule("r-exc", "EXCESS_UNIT_PRICE", opts.price, "HOUR"));
  if (opts.discount) rules.push(rule("r-disc", "DISCOUNT_FIXED", opts.discount));
  rules.push(...(opts.extraRules ?? []));
  return {
    competence: asCompetence(opts.competence ?? "2026-09-01"),
    contract: { id: CONTRACT, customerId: "cust", status: "ACTIVE", startDate: "2026-01-01", endDate: null },
    versions: [{ id: V1, versionNumber: 1, status: "ACTIVE", validFrom: "2026-01-01", validUntil: null }],
    rules,
    operationalEvents: (opts.usage ?? []).map((q, i) => ({ id: `ev-${i}`, contractId: CONTRACT, eventType: "SUPORTE", quantity: q, unit: "HOUR" })),
    otherContractsCoveringCompetence: 0,
  };
}

export const MATERIALITY_DEFAULT: MaterialityPolicy = {
  id: "m1",
  version: 1,
  mode: "COMBINED",
  absoluteThreshold: "500.00",
  percentageThreshold: "0.01",
  combinationOperator: "AND",
};
