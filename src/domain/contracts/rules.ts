/** Tipos de regra contratual e sua relevância para o motor (ADR-009). */

export const RULE_TYPES = [
  "FIXED_MONTHLY_FEE",
  "INCLUDED_QUANTITY",
  "EXCESS_UNIT_PRICE",
  "DISCOUNT_FIXED",
  "DISCOUNT_PERCENTAGE",
  "PRICE_ADJUSTMENT",
  "ADDITIONAL_SERVICE_PRICE",
  "UNIT_PRICE",
  "BILLING_PERIODICITY",
  "PAYMENT_DUE_DAY",
  "ADJUSTMENT_INDEX",
  "ADJUSTMENT_PERIODICITY",
  "OTHER",
] as const;
export type RuleType = (typeof RULE_TYPES)[number];

export const RULE_UNITS = ["HOUR", "UNIT", "USER", "TICKET", "KM", "ITEM", "VISIT", "OTHER"] as const;
export type RuleUnit = (typeof RULE_UNITS)[number];

export const RULE_STATUSES = ["PROPOSED", "CONFIRMED", "ACTIVE", "SUPERSEDED", "REJECTED"] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

/** Suportadas pelo expected_revenue_engine 1.0.0. */
export const ENGINE_SUPPORTED_RULE_TYPES: ReadonlySet<RuleType> = new Set([
  "FIXED_MONTHLY_FEE",
  "INCLUDED_QUANTITY",
  "EXCESS_UNIT_PRICE",
  "DISCOUNT_FIXED",
]);

/** Monetárias ainda não suportadas: se ACTIVE, bloqueiam o cálculo (nunca ignoradas em silêncio). */
export const ENGINE_BLOCKING_RULE_TYPES: ReadonlySet<RuleType> = new Set([
  "DISCOUNT_PERCENTAGE",
  "PRICE_ADJUSTMENT",
  "ADDITIONAL_SERVICE_PRICE",
  "UNIT_PRICE",
]);

/** Informativas: não alteram o valor esperado. */
export const INFORMATIONAL_RULE_TYPES: ReadonlySet<RuleType> = new Set([
  "BILLING_PERIODICITY",
  "PAYMENT_DUE_DAY",
  "ADJUSTMENT_INDEX",
  "ADJUSTMENT_PERIODICITY",
  "OTHER",
]);

export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  FIXED_MONTHLY_FEE: "Mensalidade fixa",
  INCLUDED_QUANTITY: "Quantidade incluída (franquia)",
  EXCESS_UNIT_PRICE: "Preço unitário do excedente",
  DISCOUNT_FIXED: "Desconto fixo autorizado",
  DISCOUNT_PERCENTAGE: "Desconto percentual",
  PRICE_ADJUSTMENT: "Reajuste de preço",
  ADDITIONAL_SERVICE_PRICE: "Preço de serviço adicional",
  UNIT_PRICE: "Preço por unidade",
  BILLING_PERIODICITY: "Periodicidade de faturamento",
  PAYMENT_DUE_DAY: "Dia de vencimento",
  ADJUSTMENT_INDEX: "Índice de reajuste",
  ADJUSTMENT_PERIODICITY: "Periodicidade de reajuste",
  OTHER: "Outra cláusula",
};

export const UNIT_LABELS: Record<string, string> = {
  HOUR: "hora",
  UNIT: "unidade",
  USER: "usuário",
  TICKET: "chamado",
  KM: "km",
  ITEM: "item",
  VISIT: "visita",
  OTHER: "outra",
  MONTH: "mês",
};

/** Tipos cujo numeric_value é dinheiro consolidado (2 casas). */
export const MONEY_RULE_TYPES: ReadonlySet<RuleType> = new Set(["FIXED_MONTHLY_FEE", "DISCOUNT_FIXED"]);
/** Tipos que exigem unidade. */
export const UNIT_RULE_TYPES: ReadonlySet<RuleType> = new Set(["INCLUDED_QUANTITY", "EXCESS_UNIT_PRICE", "UNIT_PRICE"]);
