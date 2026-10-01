import { Decimal, dec } from "../money/decimal";

/** MATERIALITY (ADR-020). Percentual como fração de expected_total; comparação `≥`. */
export type MaterialityMode = "ABSOLUTE" | "PERCENTAGE" | "COMBINED";
export type CombinationOperator = "AND" | "OR";

export interface MaterialityPolicy {
  id: string;
  version: number;
  mode: MaterialityMode;
  absoluteThreshold: string | null;
  percentageThreshold: string | null;
  combinationOperator: CombinationOperator | null;
}

export interface MaterialityEvaluation {
  policy_id: string;
  policy_version: number;
  mode: MaterialityMode;
  operator: CombinationOperator | null;
  difference: string;
  expected: string;
  ratio: string | null;
  absolute_threshold: string | null;
  percentage_threshold: string | null;
  absolute_hit: boolean | null;
  percentage_hit: boolean | null;
  material: boolean;
}

export function validatePolicy(p: Omit<MaterialityPolicy, "id" | "version">): string[] {
  const errors: string[] = [];
  const nonNeg = (v: string | null, label: string) => {
    if (v === null) return;
    try {
      if (dec(v).isNegative()) errors.push(`${label} não pode ser negativo`);
    } catch {
      errors.push(`${label} inválido`);
    }
  };
  nonNeg(p.absoluteThreshold, "limite absoluto");
  nonNeg(p.percentageThreshold, "limite percentual");
  if (p.percentageThreshold !== null) {
    try {
      if (dec(p.percentageThreshold).greaterThan(1)) errors.push("limite percentual deve ser fração entre 0 e 1");
    } catch {
      /* já registrado */
    }
  }
  if (p.mode === "ABSOLUTE" && (p.absoluteThreshold === null || p.percentageThreshold !== null || p.combinationOperator !== null))
    errors.push("modo ABSOLUTE exige somente limite absoluto");
  if (p.mode === "PERCENTAGE" && (p.percentageThreshold === null || p.absoluteThreshold !== null || p.combinationOperator !== null))
    errors.push("modo PERCENTAGE exige somente limite percentual");
  if (p.mode === "COMBINED" && (p.absoluteThreshold === null || p.percentageThreshold === null || p.combinationOperator === null))
    errors.push("modo COMBINED exige os dois limites e o operador");
  return errors;
}

export function evaluateMateriality(policy: MaterialityPolicy, difference: string, expected: string): MaterialityEvaluation {
  const diff = dec(difference).abs();
  const exp = dec(expected);
  const ratio = exp.isZero() ? null : diff.dividedBy(exp);
  const absHit = policy.absoluteThreshold === null ? null : diff.greaterThanOrEqualTo(dec(policy.absoluteThreshold));
  const pctHit =
    policy.percentageThreshold === null
      ? null
      : ratio === null
        ? diff.greaterThan(0) // sem base de comparação: qualquer diferença positiva é relevante
        : ratio.greaterThanOrEqualTo(dec(policy.percentageThreshold));

  let material: boolean;
  switch (policy.mode) {
    case "ABSOLUTE":
      material = absHit === true;
      break;
    case "PERCENTAGE":
      material = pctHit === true;
      break;
    case "COMBINED":
      material = policy.combinationOperator === "AND" ? absHit === true && pctHit === true : absHit === true || pctHit === true;
      break;
  }
  return {
    policy_id: policy.id,
    policy_version: policy.version,
    mode: policy.mode,
    operator: policy.combinationOperator,
    difference: diff.toFixed(2),
    expected: exp.toFixed(2),
    ratio: ratio === null ? null : ratio.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed(8),
    absolute_threshold: policy.absoluteThreshold,
    percentage_threshold: policy.percentageThreshold,
    absolute_hit: absHit,
    percentage_hit: pctHit,
    material: diff.isZero() ? false : material,
  };
}
