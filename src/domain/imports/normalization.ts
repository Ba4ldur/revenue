import { isValidCnpj, normalizeCnpj } from "../cnpj";
import { addMonths, competenceOf, parseCompetence, parseIsoDate, type Competence, type IsoDate } from "../competence";
import { RULE_UNITS } from "../contracts/rules";
import { Decimal, dec } from "../money/decimal";
import { canonicalJson, sha256Hex } from "../hashing";

/**
 * IMPORT NORMALIZATION ENGINE — transforma uma linha bruta (CSV/XLSX) em fato estruturado.
 * Nenhuma heurística silenciosa: formato numérico e regra de competência vêm das opções
 * escolhidas pelo usuário e ficam gravados no import (ADR-011).
 */
export const IMPORT_NORMALIZATION_ENGINE = { name: "import_normalization_engine", version: "1.0.0" } as const;

export type ImportType = "OPERATIONAL" | "BILLING";
export type RawCell = string | number | boolean | Date | null;
export type RawRow = Record<string, RawCell>;

export const MAPPABLE_FIELDS = [
  "customer_name",
  "cnpj",
  "external_customer_id",
  "contract_number",
  "date",
  "competence",
  "description",
  "quantity",
  "unit",
  "event_type",
  "amount",
  "document_number",
  "series",
  "external_event_id",
] as const;
export type MappableField = (typeof MAPPABLE_FIELDS)[number];
export type ColumnMapping = Partial<Record<MappableField, string>>;

export const FIELD_LABELS: Record<MappableField, string> = {
  customer_name: "Cliente (razão social/nome)",
  cnpj: "CNPJ",
  external_customer_id: "ID externo do cliente",
  contract_number: "Número do contrato",
  date: "Data",
  competence: "Competência",
  description: "Descrição",
  quantity: "Quantidade (horas/unidades)",
  unit: "Unidade",
  event_type: "Tipo de evento",
  amount: "Valor",
  document_number: "Número da NF / documento",
  series: "Série da NF",
  external_event_id: "ID externo do evento",
};

export type CompetenceMode =
  | { mode: "COLUMN" }
  | { mode: "FIXED"; competence: Competence }
  | { mode: "FROM_DATE"; offsetMonths: number };

export interface ImportOptions {
  numberFormat: "BR" | "US";
  competence: CompetenceMode;
  /** Unidade padrão quando não há coluna de unidade (operacional). */
  defaultUnit?: string;
  /** Tipo de evento padrão quando não há coluna (operacional). */
  defaultEventType?: string;
}

export interface FieldError {
  field: string;
  message: string;
}

export interface CustomerIdentity {
  cnpj: string | null;
  externalId: string | null;
  name: string | null;
}

export interface NormalizedOperational {
  kind: "OPERATIONAL";
  customer: CustomerIdentity;
  contractNumber: string | null;
  competence: Competence;
  eventDate: IsoDate | null;
  eventType: string;
  quantity: string;
  unit: string;
  externalId: string | null;
  description: string | null;
}

export interface NormalizedBilling {
  kind: "BILLING";
  customer: CustomerIdentity;
  contractNumber: string | null;
  competence: Competence;
  billingDate: IsoDate;
  documentNumber: string | null;
  series: string;
  amount: string;
  externalId: string | null;
  description: string | null;
}

export type NormalizedRow = NormalizedOperational | NormalizedBilling;

export type RowNormalization =
  | { ok: true; data: NormalizedRow }
  | { ok: false; errors: FieldError[] };

const UNIT_ALIASES: Record<string, string> = {
  h: "HOUR", hr: "HOUR", hrs: "HOUR", hora: "HOUR", horas: "HOUR", hour: "HOUR", hours: "HOUR",
  un: "UNIT", und: "UNIT", unid: "UNIT", unidade: "UNIT", unidades: "UNIT", unit: "UNIT",
  usuario: "USER", usuarios: "USER", user: "USER", users: "USER",
  chamado: "TICKET", chamados: "TICKET", ticket: "TICKET", tickets: "TICKET",
  km: "KM", quilometro: "KM", quilometros: "KM",
  item: "ITEM", itens: "ITEM",
  visita: "VISIT", visitas: "VISIT", visit: "VISIT",
};

export function normalizeUnit(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const s = raw.trim();
  if ((RULE_UNITS as readonly string[]).includes(s.toUpperCase())) return s.toUpperCase();
  const k = s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return UNIT_ALIASES[k] ?? null;
}

const BR_NUMBER = /^-?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/;
const US_NUMBER = /^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;

/** Número decimal estrito. Retorna string canônica ("1234.56") ou erro. Nunca usa float para texto. */
export function parseDecimalCell(raw: RawCell, format: "BR" | "US"): { ok: true; value: Decimal } | { ok: false; error: string } {
  if (raw === null || raw === "") return { ok: false, error: "valor ausente" };
  if (typeof raw === "number") {
    // Célula numérica do XLSX: já é IEEE-754 do próprio Excel; String() devolve a menor
    // representação decimal que reproduz o valor (limite de 15 dígitos do Excel).
    if (!Number.isFinite(raw)) return { ok: false, error: "número inválido" };
    return { ok: true, value: new Decimal(String(raw)) };
  }
  if (typeof raw !== "string") return { ok: false, error: "valor não numérico" };
  let s = raw.trim().replace(/^R\$\s*/i, "").replace(/\s+/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (format === "BR") {
    if (!BR_NUMBER.test(s)) return { ok: false, error: `número "${raw}" não está no formato brasileiro (1.234,56)` };
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    if (!US_NUMBER.test(s)) return { ok: false, error: `número "${raw}" não está no formato 1,234.56` };
    s = s.replace(/,/g, "");
  }
  const d = dec(s);
  return { ok: true, value: negative ? d.negated() : d };
}

function text(raw: RawCell | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return null;
  const s = String(raw).trim();
  return s === "" ? null : s;
}

function cell(row: RawRow, mapping: ColumnMapping, field: MappableField): RawCell | undefined {
  const col = mapping[field];
  return col === undefined ? undefined : row[col];
}

function resolveCompetence(row: RawRow, mapping: ColumnMapping, options: ImportOptions, date: IsoDate | null, errors: FieldError[]): Competence | null {
  switch (options.competence.mode) {
    case "COLUMN": {
      const r = parseCompetence(cell(row, mapping, "competence") ?? null);
      if (!r.ok) {
        errors.push({ field: "competence", message: r.error });
        return null;
      }
      return r.value;
    }
    case "FIXED":
      return options.competence.competence;
    case "FROM_DATE":
      if (!date) {
        errors.push({ field: "competence", message: "competência derivada da data, mas a data está ausente/inválida" });
        return null;
      }
      return addMonths(competenceOf(date), -options.competence.offsetMonths);
  }
}

function identity(row: RawRow, mapping: ColumnMapping, errors: FieldError[]): CustomerIdentity {
  const rawCnpj = text(cell(row, mapping, "cnpj"));
  let cnpj: string | null = null;
  if (rawCnpj) {
    const n = normalizeCnpj(rawCnpj);
    if (n && /^\d+$/.test(n) && n.length < 14) {
      // Planilhas removem zeros à esquerda de CNPJ numérico.
      const padded = n.padStart(14, "0");
      if (isValidCnpj(padded)) cnpj = padded;
    } else if (n && isValidCnpj(n)) cnpj = n;
    if (!cnpj) errors.push({ field: "cnpj", message: `CNPJ inválido: "${rawCnpj}"` });
  }
  const externalId = text(cell(row, mapping, "external_customer_id"));
  const name = text(cell(row, mapping, "customer_name"));
  if (!cnpj && !externalId && !name && !errors.some((e) => e.field === "cnpj")) {
    errors.push({ field: "customer", message: "linha sem identificação do cliente (CNPJ, ID externo ou nome)" });
  }
  return { cnpj, externalId, name };
}

function limit(s: string | null, max: number, field: string, errors: FieldError[]): string | null {
  if (s !== null && s.length > max) errors.push({ field, message: `${field} excede ${max} caracteres` });
  return s;
}

export function normalizeRow(type: ImportType, row: RawRow, mapping: ColumnMapping, options: ImportOptions): RowNormalization {
  const errors: FieldError[] = [];
  const customer = identity(row, mapping, errors);
  const contractNumber = limit(text(cell(row, mapping, "contract_number")), 100, "contract_number", errors);
  const description = limit(text(cell(row, mapping, "description")), 1000, "description", errors);
  const externalId = limit(text(cell(row, mapping, "external_event_id")), 200, "external_event_id", errors);

  const rawDate = cell(row, mapping, "date");
  let date: IsoDate | null = null;
  if (rawDate !== undefined && rawDate !== null && rawDate !== "") {
    const d = parseIsoDate(rawDate);
    if (d.ok) date = d.value;
    else errors.push({ field: "date", message: d.error });
  }

  if (type === "OPERATIONAL") {
    const q = parseDecimalCell(cell(row, mapping, "quantity") ?? null, options.numberFormat);
    let quantity: string | null = null;
    if (!q.ok) errors.push({ field: "quantity", message: q.error });
    else if (q.value.isNegative()) errors.push({ field: "quantity", message: "quantidade negativa não é suportada" });
    else if (q.value.decimalPlaces() > 6) errors.push({ field: "quantity", message: "quantidade com mais de 6 casas decimais" });
    else quantity = q.value.toFixed(6);

    const unitRaw = cell(row, mapping, "unit");
    const unit = mapping.unit ? normalizeUnit(unitRaw) : normalizeUnit(options.defaultUnit ?? null);
    if (!unit) errors.push({ field: "unit", message: mapping.unit ? `unidade não reconhecida: "${String(unitRaw ?? "")}"` : "unidade padrão não definida" });

    const eventType = limit(text(cell(row, mapping, "event_type")) ?? options.defaultEventType?.trim() ?? null, 100, "event_type", errors);
    if (!eventType) errors.push({ field: "event_type", message: "tipo de evento ausente" });

    const competence = resolveCompetence(row, mapping, options, date, errors);
    if (errors.length > 0 || !competence || !quantity || !unit || !eventType) return { ok: false, errors };
    return {
      ok: true,
      data: { kind: "OPERATIONAL", customer, contractNumber, competence, eventDate: date, eventType, quantity, unit, externalId, description },
    };
  }

  const a = parseDecimalCell(cell(row, mapping, "amount") ?? null, options.numberFormat);
  let amount: string | null = null;
  if (!a.ok) errors.push({ field: "amount", message: a.error });
  else if (!a.value.isPositive() || a.value.isZero())
    errors.push({ field: "amount", message: "valor deve ser positivo (notas de crédito/cancelamentos não são suportados no MVP)" });
  else if (a.value.decimalPlaces() > 2) errors.push({ field: "amount", message: "valor com mais de 2 casas decimais" });
  else amount = a.value.toFixed(2);

  if (!date) errors.push({ field: "date", message: "data de emissão obrigatória para faturamento" });
  const documentNumber = limit(text(cell(row, mapping, "document_number")), 60, "document_number", errors);
  const series = limit(text(cell(row, mapping, "series")) ?? "", 20, "series", errors) ?? "";
  const competence = resolveCompetence(row, mapping, options, date, errors);
  if (errors.length > 0 || !competence || !amount || !date) return { ok: false, errors };
  return {
    ok: true,
    data: { kind: "BILLING", customer, contractNumber, competence, billingDate: date, documentNumber, series, amount, externalId, description },
  };
}

/** Hash do conteúdo bruto (auditoria da linha). */
export function rawRowHash(row: RawRow): string {
  const plain: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(row)) plain[k] = v === null ? null : v instanceof Date ? v.toISOString() : String(v);
  return sha256Hex(canonicalJson(plain));
}

/** Hash do conteúdo de negócio normalizado (base da deduplicação). */
export function businessHash(data: NormalizedRow): string {
  return sha256Hex(canonicalJson(data));
}

/**
 * Chaves de deduplicação (ADR-008). `occurrence` = ordem da linha entre linhas de mesmo
 * conteúdo no mesmo arquivo (1, 2, ...), preservando duplicatas legítimas no arquivo.
 */
export function dedupKey(data: NormalizedRow, occurrence: number): string {
  if (data.externalId) return `ext:${data.externalId}`;
  const h = businessHash(data);
  if (data.kind === "BILLING" && data.documentNumber) return `doc:${data.series}:${data.documentNumber}:${h}:${occurrence}`;
  return `row:${h}:${occurrence}`;
}

export function assignDedupKeys(rows: Array<NormalizedRow | null>): Array<string | null> {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    if (!r) return null;
    if (r.externalId) return dedupKey(r, 1);
    const h = businessHash(r);
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return dedupKey(r, n);
  });
}
