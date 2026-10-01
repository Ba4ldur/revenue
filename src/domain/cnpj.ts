/**
 * CNPJ numérico e alfanumérico.
 * Alfanumérico: IN RFB nº 2.229/2024 (vigência a partir de julho/2026): 12 posições [0-9A-Z]
 * e 2 dígitos verificadores numéricos; cada caractere vale (código ASCII − 48); pesos do
 * módulo 11 iguais aos do CNPJ numérico. VERIFICAR contra a documentação técnica oficial da
 * Receita Federal antes de produção. Mesmo algoritmo implementado em app.is_valid_cnpj (SQL).
 */

const W1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const W2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

export function normalizeCnpj(input: unknown): string | null {
  if (typeof input !== "string" && typeof input !== "number") return null;
  const s = String(input).toUpperCase().replace(/[\s./-]/g, "");
  return s === "" ? null : s;
}

function charValue(c: string): number {
  return c.charCodeAt(0) - 48;
}

function checkDigit(chars: string[], weights: number[]): number {
  const total = chars.reduce((acc, c, i) => acc + charValue(c) * weights[i]!, 0);
  const r = total % 11;
  return r < 2 ? 0 : 11 - r;
}

export function isValidCnpj(value: string | null | undefined): boolean {
  if (!value || !/^[0-9A-Z]{12}[0-9]{2}$/.test(value)) return false;
  if (/^(\d)\1{13}$/.test(value)) return false;
  const chars = value.split("");
  const d1 = checkDigit(chars.slice(0, 12), W1);
  const d2 = checkDigit([...chars.slice(0, 12), String(d1)], W2);
  return value[12] === String(d1) && value[13] === String(d2);
}

export function formatCnpj(value: string | null | undefined): string {
  if (!value || value.length !== 14) return value ?? "—";
  return `${value.slice(0, 2)}.${value.slice(2, 5)}.${value.slice(5, 8)}/${value.slice(8, 12)}-${value.slice(12)}`;
}
