import { dec, sum } from "../money/decimal";

/**
 * FINANCIAL_INVARIANTS. Retorna a lista de violações (vazia = íntegro).
 * Executado no motor antes de qualquer persistência e novamente no banco (constraint
 * trigger diferido) — defesa em profundidade.
 */
export interface InvariantSubject {
  baseAmount: string;
  variableAmount: string;
  adjustmentAmount: string;
  discountAmount: string;
  expectedTotal: string;
  components: Array<{ componentType: string; amount: string }>;
}

export function checkExpectedRevenueInvariants(e: InvariantSubject): string[] {
  const v: string[] = [];
  const total = dec(e.expectedTotal);
  const of = (...types: string[]) => sum(e.components.filter((c) => types.includes(c.componentType)).map((c) => c.amount));

  if (e.components.length === 0) v.push("expected revenue sem componentes");
  const componentsTotal = sum(e.components.map((c) => c.amount));
  if (!componentsTotal.equals(total)) {
    v.push(`SUM(componentes)=${componentsTotal.toFixed(2)} ≠ expected_total=${total.toFixed(2)}`);
  }
  const classified = dec(e.baseAmount).plus(e.variableAmount).plus(e.adjustmentAmount).minus(e.discountAmount);
  if (!classified.equals(total)) {
    v.push(`base+variável+ajuste−desconto=${classified.toFixed(2)} ≠ expected_total=${total.toFixed(2)}`);
  }
  if (!of("BASE").equals(dec(e.baseAmount))) v.push("base_amount incompatível com componentes BASE");
  if (!of("EXCESS", "ADDITIONAL_SERVICE").equals(dec(e.variableAmount))) v.push("variable_amount incompatível com componentes variáveis");
  if (!of("ADJUSTMENT", "OTHER").equals(dec(e.adjustmentAmount))) v.push("adjustment_amount incompatível com componentes de ajuste");
  if (!of("DISCOUNT").negated().equals(dec(e.discountAmount))) v.push("discount_amount incompatível com componentes de desconto");
  for (const c of e.components) {
    const a = dec(c.amount);
    if (c.componentType === "DISCOUNT" && a.isPositive() && !a.isZero()) v.push("componente de desconto positivo");
    if (["BASE", "EXCESS", "ADDITIONAL_SERVICE"].includes(c.componentType) && a.isNegative()) v.push(`componente ${c.componentType} negativo`);
    if (a.decimalPlaces() > 2) v.push(`componente com mais de 2 casas: ${c.amount}`);
  }
  if (total.isNegative()) v.push("expected_total negativo");
  return v;
}

export function checkFindingInvariant(f: { expectedAmount: string; billedAmount: string; differenceAmount: string }): string[] {
  const diff = dec(f.expectedAmount).minus(f.billedAmount);
  return diff.equals(dec(f.differenceAmount)) ? [] : [`difference_amount ${f.differenceAmount} ≠ expected − billed ${diff.toFixed(2)}`];
}
