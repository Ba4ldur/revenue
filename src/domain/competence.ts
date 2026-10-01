/**
 * Competência mensal (ADR-004): persistida como DATE no dia 1 ('YYYY-MM-01').
 * Parser estrito no padrão brasileiro. Entrada ambígua é erro — nunca adivinhamos.
 */

export type Competence = string & { readonly __brand: "Competence" };
export type IsoDate = string & { readonly __brand: "IsoDate" };

const MONTHS_PT: Record<string, number> = {
  jan: 1, janeiro: 1, fev: 2, fevereiro: 2, mar: 3, marco: 3, abr: 4, abril: 4, mai: 5, maio: 5,
  jun: 6, junho: 6, jul: 7, julho: 7, ago: 8, agosto: 8, set: 9, setembro: 9, out: 10, outubro: 10,
  nov: 11, novembro: 11, dez: 12, dezembro: 12,
};
const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function makeCompetence(year: number, month: number): Competence {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new RangeError(`ano inválido: ${year}`);
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError(`mês inválido: ${month}`);
  return `${year}-${pad2(month)}-01` as Competence;
}

export function isCompetence(value: string): value is Competence {
  return /^(20\d{2}|2100)-(0[1-9]|1[0-2])-01$/.test(value);
}

export function asCompetence(value: string): Competence {
  if (!isCompetence(value)) throw new RangeError(`competência inválida: ${value}`);
  return value;
}

function expandYear(y: string): number {
  return y.length === 2 ? 2000 + Number(y) : Number(y);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function makeIsoDate(year: number, month: number, day: number): IsoDate | null {
  if (year < 1900 || year > 2100 || month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return `${year}-${pad2(month)}-${pad2(day)}` as IsoDate;
}

/** Datas: 'DD/MM/AAAA', 'DD-MM-AAAA', 'AAAA-MM-DD' ou Date (célula XLSX, interpretada em UTC). */
export function parseIsoDate(input: unknown): ParseResult<IsoDate> {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return { ok: false, error: "data inválida" };
    const d = makeIsoDate(input.getUTCFullYear(), input.getUTCMonth() + 1, input.getUTCDate());
    return d ? { ok: true, value: d } : { ok: false, error: "data fora do intervalo" };
  }
  if (typeof input !== "string") return { ok: false, error: "data ausente" };
  const s = input.trim();
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) {
    const d = makeIsoDate(Number(m[3]), Number(m[2]), Number(m[1]));
    return d ? { ok: true, value: d } : { ok: false, error: `data inválida: "${s}" (formato DD/MM/AAAA)` };
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  if (m) {
    const d = makeIsoDate(Number(m[1]), Number(m[2]), Number(m[3]));
    return d ? { ok: true, value: d } : { ok: false, error: `data inválida: "${s}"` };
  }
  return { ok: false, error: `formato de data não reconhecido: "${s}" (use DD/MM/AAAA)` };
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Competência a partir de texto: '2026-09', '2026-09-01', '09/2026', '9/2026', 'set/26',
 * 'set/2026', 'setembro/2026', 'setembro de 2026', 'DD/MM/AAAA' (→ mês) ou Date.
 */
export function parseCompetence(input: unknown): ParseResult<Competence> {
  if (input instanceof Date) {
    const d = parseIsoDate(input);
    return d.ok ? { ok: true, value: competenceOf(d.value) } : d;
  }
  if (typeof input !== "string" || input.trim() === "") return { ok: false, error: "competência ausente" };
  const s = stripAccents(input.trim().toLowerCase());
  let m = /^(\d{4})-(\d{1,2})(?:-01)?$/.exec(s);
  if (m) return safeMake(Number(m[1]), Number(m[2]), input);
  m = /^(\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return safeMake(Number(m[2]), Number(m[1]), input);
  m = /^([a-z]+)(?:\s*[/.-]\s*|\s+de\s+|\s+)(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS_PT[m[1]!];
    if (!month) return { ok: false, error: `mês não reconhecido: "${input}"` };
    return safeMake(expandYear(m[2]!), month, input);
  }
  const d = parseIsoDate(s);
  if (d.ok) return { ok: true, value: competenceOf(d.value) };
  return { ok: false, error: `competência não reconhecida: "${input}" (use MM/AAAA)` };
}

function safeMake(year: number, month: number, raw: unknown): ParseResult<Competence> {
  try {
    return { ok: true, value: makeCompetence(year, month) };
  } catch {
    return { ok: false, error: `competência inválida: "${String(raw)}"` };
  }
}

export function competenceOf(date: IsoDate | string): Competence {
  return asCompetence(`${date.slice(0, 7)}-01`);
}

export function addMonths(c: Competence, months: number): Competence {
  const y = Number(c.slice(0, 4));
  const m = Number(c.slice(5, 7)) - 1 + months;
  return makeCompetence(y + Math.floor(m / 12), (((m % 12) + 12) % 12) + 1);
}

/** Último dia do mês da competência. */
export function lastDayOf(c: Competence): IsoDate {
  const y = Number(c.slice(0, 4));
  const m = Number(c.slice(5, 7));
  return makeIsoDate(y, m, daysInMonth(y, m))!;
}

export function competenceRange(from: Competence, until: Competence): Competence[] {
  const out: Competence[] = [];
  for (let c = from; c <= until; c = addMonths(c, 1)) out.push(c);
  return out;
}

export function formatCompetence(c: string): string {
  return `${c.slice(5, 7)}/${c.slice(0, 4)}`;
}

export function formatCompetenceLong(c: string): string {
  return `${MONTH_NAMES[Number(c.slice(5, 7)) - 1]} de ${c.slice(0, 4)}`;
}

export function formatDateBR(d: string | null | undefined): string {
  if (!d) return "—";
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

/** Relação de um intervalo de datas [from, until|∞] com o mês da competência. */
export function monthCoverage(c: Competence, from: string, until: string | null): "FULL" | "PARTIAL" | "NONE" {
  const first = c as string;
  const last = lastDayOf(c) as string;
  if (from > last || (until !== null && until < first)) return "NONE";
  if (from <= first && (until === null || until >= last)) return "FULL";
  return "PARTIAL";
}
