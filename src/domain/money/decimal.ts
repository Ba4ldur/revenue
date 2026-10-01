import DecimalBase from "decimal.js";

/**
 * Aritmética decimal exata (ADR-002, ADR-003).
 * - Entradas SEMPRE como string (ou Decimal). `number` é rejeitado em tempo de execução
 *   para impedir que valores monetários passem por float.
 * - Arredondamento só ocorre explicitamente via `roundMoney` (ROUND_HALF_UP, 2 casas).
 */
export const Decimal = DecimalBase.clone({
  precision: 40,
  rounding: DecimalBase.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 40,
});
export type Decimal = InstanceType<typeof Decimal>;

export const MONEY_SCALE = 2;
export const QUANTITY_SCALE = 6;
export const UNIT_PRICE_SCALE = 6;
export const ROUNDING_MODE_NAME = "ROUND_HALF_UP" as const;

const DECIMAL_TEXT = /^-?\d+(\.\d+)?$/;

export function dec(value: string | Decimal): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value !== "string") {
    throw new TypeError(`valor decimal deve ser string, recebido ${typeof value}`);
  }
  const v = value.trim();
  if (!DECIMAL_TEXT.test(v)) throw new RangeError(`valor decimal inválido: "${value}"`);
  return new Decimal(v);
}

export const ZERO = new Decimal(0);

export function sum(values: Array<string | Decimal>): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), ZERO);
}

/** Único ponto de arredondamento monetário. */
export function roundMoney(value: Decimal): Decimal {
  return value.toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

export function scaleOf(value: Decimal): number {
  return value.decimalPlaces();
}

export function assertMaxScale(value: Decimal, scale: number, label: string): void {
  if (value.decimalPlaces() > scale) {
    throw new RangeError(`${label} excede ${scale} casas decimais: ${value.toString()}`);
  }
}

/** Serialização para numeric(18,2). Exige valor já arredondado. */
export function toMoneyString(value: Decimal): string {
  assertMaxScale(value, MONEY_SCALE, "valor monetário");
  return value.toFixed(MONEY_SCALE);
}

/** Serialização para numeric(18,6). Não arredonda: excesso de escala é erro. */
export function toScale6String(value: Decimal): string {
  assertMaxScale(value, QUANTITY_SCALE, "quantidade/preço unitário");
  return value.toFixed(QUANTITY_SCALE);
}

export function max(a: Decimal, b: Decimal): Decimal {
  return a.greaterThan(b) ? a : b;
}

/** "4760.00" → "R$ 4.760,00" sem conversão para float. */
export function formatBRL(value: string | Decimal): string {
  const d = roundMoney(dec(value));
  const negative = d.isNegative();
  const [intPart, frac] = d.abs().toFixed(2).split(".") as [string, string];
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}R$ ${grouped},${frac}`;
}

/** Quantidade para exibição: "17.000000" → "17"; "1.5" → "1,5". */
export function formatQuantity(value: string | Decimal): string {
  const d = dec(value);
  const [intPart, frac] = d.toFixed().split(".") as [string, string | undefined];
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return frac ? `${grouped},${frac}` : grouped;
}

/** Percentual a partir de fração: "0.01" → "1%". */
export function formatPercentFraction(value: string | Decimal, decimals = 2): string {
  const d = dec(value).times(100);
  const s = d.toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP).toFixed();
  return `${s.replace(".", ",")}%`;
}

/** Preço unitário (até 6 casas) sem perder precisão: "280.000000" → "R$ 280,00"; "0.123456" → "R$ 0,123456". */
export function formatUnitPrice(value: string | Decimal): string {
  const d = dec(value);
  if (d.decimalPlaces() <= 2) return formatBRL(d);
  const [i, f] = d.abs().toFixed().split(".") as [string, string];
  return `${d.isNegative() ? "-" : ""}R$ ${i.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${f}`;
}
