import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkExpectedRevenueInvariants, checkFindingInvariant } from "@/domain/revenue/invariants";
import { dec, formatBRL, roundMoney, toMoneyString } from "@/domain/money/decimal";

describe("TESTE 15 — invariantes financeiras", () => {
  const good = {
    baseAmount: "18000.00",
    variableAmount: "4760.00",
    adjustmentAmount: "0.00",
    discountAmount: "0.00",
    expectedTotal: "22760.00",
    components: [
      { componentType: "BASE", amount: "18000.00" },
      { componentType: "EXCESS", amount: "4760.00" },
    ],
  };

  it("resultado íntegro não tem violações", () => {
    expect(checkExpectedRevenueInvariants(good)).toEqual([]);
  });

  it("soma de componentes ≠ expected_total ⇒ erro", () => {
    const bad = { ...good, components: [{ componentType: "BASE", amount: "18000.00" }, { componentType: "EXCESS", amount: "4700.00" }] };
    expect(checkExpectedRevenueInvariants(bad).join(" ")).toMatch(/SUM\(componentes\)=22700.00 ≠ expected_total=22760.00/);
  });

  it("classificação incompatível ⇒ erro", () => {
    expect(checkExpectedRevenueInvariants({ ...good, baseAmount: "18100.00" })).not.toEqual([]);
  });

  it("desconto positivo ou componente sem componentes ⇒ erro", () => {
    expect(checkExpectedRevenueInvariants({ ...good, components: [] })).not.toEqual([]);
    expect(
      checkExpectedRevenueInvariants({
        ...good,
        discountAmount: "-100.00",
        expectedTotal: "22860.00",
        components: [...good.components, { componentType: "DISCOUNT", amount: "100.00" }],
      }),
    ).not.toEqual([]);
  });

  it("finding: difference = expected − billed", () => {
    expect(checkFindingInvariant({ expectedAmount: "22760.00", billedAmount: "18000.00", differenceAmount: "4760.00" })).toEqual([]);
    expect(checkFindingInvariant({ expectedAmount: "22760.00", billedAmount: "18000.00", differenceAmount: "4700.00" })).not.toEqual([]);
  });
});

describe("Política monetária", () => {
  it("rejeita number em tempo de execução (dinheiro nunca passa por float)", () => {
    expect(() => dec(0.1 as unknown as string)).toThrow(TypeError);
    expect(() => dec("1,5")).toThrow(RangeError);
  });

  it("ROUND_HALF_UP só quando chamado; serialização exige escala correta", () => {
    expect(roundMoney(dec("2.345")).toFixed(2)).toBe("2.35");
    expect(roundMoney(dec("-2.345")).toFixed(2)).toBe("-2.35");
    expect(() => toMoneyString(dec("2.345"))).toThrow(/excede 2 casas/);
  });

  it("formata BRL sem float", () => {
    expect(formatBRL("4760")).toBe("R$ 4.760,00");
    expect(formatBRL("1234567.89")).toBe("R$ 1.234.567,89");
    expect(formatBRL("-0.5")).toBe("-R$ 0,50");
  });

  it("módulos de domínio não usam parseFloat/Number()/toFixed em float", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts")) files.push(p);
      }
    };
    walk(join(process.cwd(), "src/domain"));
    const offenders = files.filter((f) => /parseFloat\(|Number\.parseFloat|\bparseInt\([^)]*amount/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
