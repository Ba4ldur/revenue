import { describe, expect, it } from "vitest";
import { calculateExpectedRevenue, EXPECTED_REVENUE_ENGINE, type ExpectedRevenueResult } from "@/domain/revenue/expected-revenue-engine";
import { hashCanonical } from "@/domain/hashing";
import { CONTRACT, V1, V2, rule, scenario } from "./engine-fixtures";

function calculated(input: Parameters<typeof calculateExpectedRevenue>[0]): ExpectedRevenueResult {
  const out = calculateExpectedRevenue(input);
  if (out.status !== "CALCULATED") throw new Error(`esperava CALCULATED, obtive ${out.status}: ${"message" in out ? out.message : ""}`);
  return out.result;
}

describe("Expected Revenue Engine 1.0.0", () => {
  it("TESTE 1 — excedente: franquia 100 h, uso 117 h, R$ 280/h ⇒ R$ 4.760,00", () => {
    const r = calculated(scenario({ fee: "20000.00", included: "100", price: "280", usage: ["117"] }));
    const excess = r.components.find((c) => c.componentType === "EXCESS")!;
    expect(excess.quantity).toBe("17.000000");
    expect(excess.amount).toBe("4760.00");
    expect(r.variableAmount).toBe("4760.00");
    expect(r.expectedTotal).toBe("24760.00");
  });

  it("cenário canônico: R$ 18.000 + (57 − 40) × R$ 280 = R$ 22.760,00 com memória de cálculo", () => {
    const r = calculated(scenario({ fee: "18000.00", included: "40", price: "280", usage: ["30", "27"] }));
    expect(r).toMatchObject({ baseAmount: "18000.00", variableAmount: "4760.00", discountAmount: "0.00", expectedTotal: "22760.00" });
    const excess = r.components.find((c) => c.componentType === "EXCESS")!;
    expect(excess.calculationFormula).toBe("max(0, 57 − 40) = 17; 17 × 280.00 = 4760.00");
    expect(excess.calculationMetadata).toMatchObject({
      engine: EXPECTED_REVENUE_ENGINE,
      inputs: { usage: "57", included_quantity: "40", excess_unit_price: "280" },
      rounding: { mode: "ROUND_HALF_UP", scale: 2 },
    });
    expect(excess.sources.map((s) => s.role).sort()).toEqual(["INCLUDED_QUANTITY", "UNIT_PRICE", "USAGE", "USAGE"]);
  });

  it("uso dentro da franquia gera componente EXCESS zerado (rastreável)", () => {
    const r = calculated(scenario({ fee: "18000.00", included: "40", price: "280", usage: ["39.5"] }));
    expect(r.components.find((c) => c.componentType === "EXCESS")!.amount).toBe("0.00");
    expect(r.expectedTotal).toBe("18000.00");
  });

  it("TESTE 3 (parte expected) — desconto autorizado: 20.000 − 1.500 = 18.500", () => {
    const r = calculated(scenario({ fee: "20000.00", discount: "1500.00" }));
    expect(r.discountAmount).toBe("1500.00");
    expect(r.expectedTotal).toBe("18500.00");
    expect(r.components.find((c) => c.componentType === "DISCOUNT")!.amount).toBe("-1500.00");
  });

  it("arredondamento ocorre só no componente (ROUND_HALF_UP): 0,5 h × R$ 0,01 = R$ 0,01", () => {
    const r = calculated(scenario({ included: "0", price: "0.010000", usage: ["0.5"] }));
    expect(r.components[0]!.calculationMetadata).toMatchObject({ intermediate: { unrounded_amount: "0.005" } });
    expect(r.expectedTotal).toBe("0.01");
  });

  it("sem float: frações decimais exatas (0,1 + 0,2 h)", () => {
    const r = calculated(scenario({ included: "0", price: "100", usage: ["0.1", "0.2"] }));
    expect(r.expectedTotal).toBe("30.00");
  });

  it("TESTE 6 — reprodutibilidade: mesmas entradas ⇒ resultado idêntico (bit a bit)", () => {
    const input = scenario({ fee: "18000.00", included: "40", price: "280", usage: ["57"] });
    const a = calculated(input);
    const b = calculated(structuredClone(input));
    expect(hashCanonical(a)).toBe(hashCanonical(b));
    // ordem de entrada não altera o resultado
    const shuffled = { ...input, rules: [...input.rules].reverse() };
    expect(hashCanonical(calculated(shuffled))).toBe(hashCanonical(a));
  });

  it("TESTE 14 — maio usa versão 1 (R$ 18.000) e agosto usa versão 2 (R$ 20.000)", () => {
    const base = scenario({});
    const input = {
      ...base,
      versions: [
        { id: V1, versionNumber: 1, status: "ACTIVE" as const, validFrom: "2026-01-01", validUntil: "2026-06-30" },
        { id: V2, versionNumber: 2, status: "ACTIVE" as const, validFrom: "2026-07-01", validUntil: null },
      ],
      rules: [
        rule("fee-v1", "FIXED_MONTHLY_FEE", "18000.00", null, { versionId: V1, validUntil: "2026-06-30" }),
        rule("fee-v2", "FIXED_MONTHLY_FEE", "20000.00", null, { versionId: V2, validFrom: "2026-07-01" }),
      ],
    };
    const may = calculated({ ...input, competence: "2026-05-01" as never });
    const aug = calculated({ ...input, competence: "2026-08-01" as never });
    expect([may.contractVersionId, may.expectedTotal]).toEqual([V1, "18000.00"]);
    expect([aug.contractVersionId, aug.expectedTotal]).toEqual([V2, "20000.00"]);
  });

  it("regra PROPOSED/CONFIRMED nunca participa do cálculo", () => {
    const input = scenario({ fee: "18000.00" });
    input.rules.push(rule("r-prop", "DISCOUNT_FIXED", "5000.00", null, { status: "PROPOSED" }));
    input.rules.push(rule("r-conf", "DISCOUNT_FIXED", "4000.00", null, { status: "CONFIRMED" }));
    expect(calculated(input).expectedTotal).toBe("18000.00");
  });

  describe("tratamento conservador (NEEDS_REVIEW, nunca inventa)", () => {
    const cases: Array<[string, Parameters<typeof calculateExpectedRevenue>[0], string]> = [
      ["sem regras monetárias", scenario({}), "NO_MONETARY_RULES"],
      ["preço sem franquia explícita", scenario({ price: "280", usage: ["10"] }), "MISSING_INCLUDED_QUANTITY"],
      ["uso acima da franquia sem preço", scenario({ fee: "1000.00", included: "40", usage: ["50"] }), "MISSING_EXCESS_PRICE"],
      ["regra monetária não suportada ativa", scenario({ fee: "1000.00", extraRules: [rule("r-pct", "DISCOUNT_PERCENTAGE", "0.1")] }), "UNSUPPORTED_RULE_TYPE"],
      ["desconto maior que bruto", scenario({ fee: "1000.00", discount: "2000.00" }), "DISCOUNT_EXCEEDS_GROSS"],
    ];
    for (const [label, input, code] of cases) {
      it(label, () => {
        const out = calculateExpectedRevenue(input);
        expect(out.status).toBe("NEEDS_REVIEW");
        expect("code" in out && out.code).toBe(code);
      });
    }

    it("troca de versão no meio do mês", () => {
      const input = scenario({ fee: "1000.00" });
      input.versions = [
        { id: V1, versionNumber: 1, status: "ACTIVE", validFrom: "2026-01-01", validUntil: "2026-09-14" },
        { id: V2, versionNumber: 2, status: "ACTIVE", validFrom: "2026-09-15", validUntil: null },
      ];
      expect(calculateExpectedRevenue(input)).toMatchObject({ status: "NEEDS_REVIEW", code: "MID_MONTH_VERSION_CHANGE" });
    });

    it("evento sem contrato com cliente de vários contratos", () => {
      const input = scenario({ fee: "1000.00", included: "10", price: "1", usage: ["20"] });
      input.operationalEvents[0]!.contractId = null;
      input.otherContractsCoveringCompetence = 1;
      expect(calculateExpectedRevenue(input)).toMatchObject({ status: "NEEDS_REVIEW", code: "AMBIGUOUS_EVENT_ATTRIBUTION" });
    });

    it("contrato iniciado no meio do mês", () => {
      const input = scenario({ fee: "1000.00" });
      input.contract.startDate = "2026-09-10";
      input.versions[0]!.validFrom = "2026-09-10";
      expect(calculateExpectedRevenue(input)).toMatchObject({ status: "NEEDS_REVIEW", code: "PARTIAL_MONTH_CONTRACT" });
    });

    it("contrato fora da vigência não é aplicável", () => {
      const input = scenario({ fee: "1000.00", competence: "2025-12-01" });
      expect(calculateExpectedRevenue(input)).toMatchObject({ status: "NOT_APPLICABLE" });
    });
  });

  it("eventos em unidade sem regra são ignorados com aviso explícito", () => {
    const input = scenario({ fee: "1000.00" });
    input.operationalEvents.push({ id: "km-1", contractId: CONTRACT, eventType: "DESLOC", quantity: "300", unit: "KM" });
    const r = calculated(input);
    expect(r.expectedTotal).toBe("1000.00");
    expect(r.warnings.join(" ")).toMatch(/KM sem regra/);
  });
});
