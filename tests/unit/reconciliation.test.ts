import { describe, expect, it } from "vitest";
import { asCompetence } from "@/domain/competence";
import { reconcile, type ReconciliationInput, type ReconciliationResult } from "@/domain/reconciliation/reconciliation-engine";
import { evaluateMateriality, validatePolicy } from "@/domain/reconciliation/materiality";
import { calculateExpectedRevenue } from "@/domain/revenue/expected-revenue-engine";
import { CONTRACT, MATERIALITY_DEFAULT, scenario } from "./engine-fixtures";

function input(expected: Partial<ReconciliationInput["expected"]> & { expectedTotal: string }, billed: string[], extra: Partial<ReconciliationInput> = {}): ReconciliationInput {
  return {
    competence: asCompetence("2026-09-01"),
    contractId: CONTRACT,
    expected: { expectedRevenueEventId: "ere", baseAmount: expected.expectedTotal, variableAmount: "0.00", adjustmentAmount: "0.00", discountAmount: "0.00", ...expected },
    billingEvents: billed.map((a, i) => ({ id: `b-${i}`, amount: a, contractId: CONTRACT, documentNumber: `NF-${i + 1}` })),
    otherContractsCoveringCompetence: 0,
    materiality: MATERIALITY_DEFAULT,
    ...extra,
  };
}

function reconciled(i: ReconciliationInput): ReconciliationResult {
  const out = reconcile(i);
  if (out.status !== "RECONCILED") throw new Error(out.message);
  return out.result;
}

describe("Reconciliation Engine 1.0.0", () => {
  it("cenário canônico ⇒ CONSUMO_EXCEDENTE_NAO_FATURADO de R$ 4.760,00", () => {
    const ere = calculateExpectedRevenue(scenario({ fee: "18000.00", included: "40", price: "280", usage: ["57"] }));
    if (ere.status !== "CALCULATED") throw new Error("falha");
    const r = reconciled(input({ ...ere.result, expectedTotal: ere.result.expectedTotal }, ["18000.00"]));
    expect(r.outcome).toBe("FINDING");
    expect(r.finding).toMatchObject({
      findingType: "CONSUMO_EXCEDENTE_NAO_FATURADO",
      expectedAmount: "22760.00",
      billedAmount: "18000.00",
      differenceAmount: "4760.00",
      severity: "HIGH",
    });
    expect(r.finding!.explanation).toMatch(/^Possível receita não faturada: R\$ 4\.760,00\./);
    expect(r.finding!.explanation).not.toMatch(/perdeu/i);
  });

  it("TESTE 2 — cobrança abaixo: 20.000 esperado, 18.500 faturado ⇒ diferença 1.500", () => {
    const r = reconciled(input({ expectedTotal: "20000.00" }, ["18500.00"]));
    expect(r.finding).toMatchObject({ findingType: "COBRANCA_ABAIXO_DO_CONTRATO", differenceAmount: "1500.00" });
  });

  it("TESTE 3 — desconto autorizado: líquido 18.500 = faturado 18.500 ⇒ sem finding", () => {
    const ere = calculateExpectedRevenue(scenario({ fee: "20000.00", discount: "1500.00" }));
    if (ere.status !== "CALCULATED") throw new Error("falha");
    const r = reconciled(input({ ...ere.result }, ["18500.00"]));
    expect(r.outcome).toBe("NO_DIVERGENCE");
    expect(r.finding).toBeNull();
    expect(r.knownExplanationsEvaluated).toEqual(["DISCOUNT_FIXED"]);
  });

  it("TESTE 4 — contrato ativo sem faturamento ⇒ CLIENTE_ATIVO_SEM_FATURAMENTO", () => {
    const r = reconciled(input({ expectedTotal: "18000.00" }, []));
    expect(r.finding).toMatchObject({ findingType: "CLIENTE_ATIVO_SEM_FATURAMENTO", billedAmount: "0.00", differenceAmount: "18000.00", severity: "CRITICAL" });
  });

  it("faturamento acima do esperado não gera finding no MVP (registrado)", () => {
    const r = reconciled(input({ expectedTotal: "18000.00" }, ["19000.00"]));
    expect(r.outcome).toBe("OVERBILLED_NOT_EVALUATED");
    expect(r.differenceAmount).toBe("-1000.00");
  });

  it("várias NFs na competência são somadas", () => {
    const r = reconciled(input({ expectedTotal: "20000.00" }, ["10000.00", "9999.99"]));
    expect(r.billedAmount).toBe("19999.99");
    expect(r.outcome).toBe("BELOW_MATERIALITY");
  });

  it("faturamento sem contrato para cliente com vários contratos ⇒ NEEDS_REVIEW", () => {
    const i = input({ expectedTotal: "20000.00" }, ["100.00"]);
    i.billingEvents[0]!.contractId = null;
    i.otherContractsCoveringCompetence = 2;
    expect(reconcile(i)).toMatchObject({ status: "NEEDS_REVIEW", code: "AMBIGUOUS_BILLING_ATTRIBUTION" });
  });

  it("TESTE 6 — reconciliação reprodutível", () => {
    const i = input({ expectedTotal: "20000.00" }, ["18500.00"]);
    expect(reconcile(structuredClone(i))).toEqual(reconcile(i));
  });
});

describe("TESTE 10 — Materialidade AND × OR", () => {
  const and = { ...MATERIALITY_DEFAULT, combinationOperator: "AND" as const };
  const or = { ...MATERIALITY_DEFAULT, combinationOperator: "OR" as const };

  it("diferença R$ 400 em contrato de R$ 10.000 (4%): AND ⇒ não material; OR ⇒ material", () => {
    expect(evaluateMateriality(and, "400.00", "10000.00").material).toBe(false);
    expect(evaluateMateriality(or, "400.00", "10000.00").material).toBe(true);
  });

  it("diferença R$ 600 em contrato de R$ 100.000 (0,6%): AND ⇒ não; OR ⇒ sim", () => {
    expect(evaluateMateriality(and, "600.00", "100000.00")).toMatchObject({ absolute_hit: true, percentage_hit: false, material: false });
    expect(evaluateMateriality(or, "600.00", "100000.00").material).toBe(true);
  });

  it("diferença R$ 1.500 em R$ 20.000 (7,5%): ambos materiais", () => {
    expect(evaluateMateriality(and, "1500.00", "20000.00").material).toBe(true);
    expect(evaluateMateriality(or, "1500.00", "20000.00").material).toBe(true);
  });

  it("limites são inclusivos (≥) e diferença zero nunca é material", () => {
    expect(evaluateMateriality({ ...and, absoluteThreshold: "500.00", percentageThreshold: "0.025" }, "500.00", "20000.00").material).toBe(true);
    expect(evaluateMateriality({ ...or, absoluteThreshold: "0.00", percentageThreshold: "0" }, "0.00", "100.00").material).toBe(false);
  });

  it("efeito na reconciliação: mesmo dado, finding só com OR", () => {
    expect(reconciled(input({ expectedTotal: "10000.00" }, ["9600.00"], { materiality: and })).outcome).toBe("BELOW_MATERIALITY");
    expect(reconciled(input({ expectedTotal: "10000.00" }, ["9600.00"], { materiality: or })).outcome).toBe("FINDING");
  });

  it("modos ABSOLUTE e PERCENTAGE e validação de política", () => {
    const abs = { ...MATERIALITY_DEFAULT, mode: "ABSOLUTE" as const, percentageThreshold: null, combinationOperator: null };
    const pct = { ...MATERIALITY_DEFAULT, mode: "PERCENTAGE" as const, absoluteThreshold: null, combinationOperator: null };
    expect(evaluateMateriality(abs, "499.99", "1000.00").material).toBe(false);
    expect(evaluateMateriality(pct, "10.00", "1000.00").material).toBe(true);
    expect(validatePolicy({ mode: "COMBINED", absoluteThreshold: "500", percentageThreshold: null, combinationOperator: "AND" })).not.toEqual([]);
    expect(validatePolicy({ mode: "PERCENTAGE", absoluteThreshold: null, percentageThreshold: "1.5", combinationOperator: null })).not.toEqual([]);
  });
});
