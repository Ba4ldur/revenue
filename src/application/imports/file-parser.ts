import Papa from "papaparse";
import ExcelJS from "exceljs";
import type { RawCell, RawRow } from "@/domain/imports/normalization";

export const MAX_IMPORT_ROWS = 20_000;
export const MAX_IMPORT_COLUMNS = 60;

export interface ParsedFile {
  headers: string[];
  rows: RawRow[];
  encoding?: string;
  delimiter?: string;
  sheetName?: string;
}

export class FileParseError extends Error {}

function normalizeHeaders(raw: unknown[]): string[] {
  const headers = raw.map((h, i) => {
    const s = h === null || h === undefined ? "" : String(h).replace(/^﻿/, "").trim();
    return s === "" ? `Coluna ${i + 1}` : s.slice(0, 120);
  });
  const seen = new Set<string>();
  for (const h of headers) {
    if (seen.has(h.toLowerCase())) throw new FileParseError(`Cabeçalho duplicado: "${h}"`);
    seen.add(h.toLowerCase());
  }
  if (headers.length > MAX_IMPORT_COLUMNS) throw new FileParseError(`Mais de ${MAX_IMPORT_COLUMNS} colunas`);
  return headers;
}

function decode(bytes: Uint8Array): { text: string; encoding: string } {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    // Exportações do Excel no Brasil frequentemente usam Windows-1252.
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

export function parseCsv(bytes: Uint8Array): ParsedFile {
  const { text, encoding } = decode(bytes);
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ""), {
    header: false,
    skipEmptyLines: "greedy",
    delimitersToGuess: [";", ",", "\t", "|"],
  });
  const fatal = result.errors.find((e) => e.type === "Quotes" || e.type === "Delimiter");
  if (fatal && result.data.length === 0) throw new FileParseError(`CSV inválido: ${fatal.message}`);
  const [head, ...body] = result.data;
  if (!head) throw new FileParseError("Arquivo sem cabeçalho");
  const headers = normalizeHeaders(head);
  if (body.length > MAX_IMPORT_ROWS) throw new FileParseError(`Mais de ${MAX_IMPORT_ROWS} linhas; divida o arquivo`);
  const rows = body.map((cells) => {
    const row: RawRow = {};
    headers.forEach((h, i) => {
      const v = cells[i];
      row[h] = v === undefined || v.trim() === "" ? null : v;
    });
    return row;
  });
  return { headers, rows, encoding, delimiter: result.meta.delimiter };
}

function cellValue(v: ExcelJS.CellValue): RawCell {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("formula" in v || "sharedFormula" in v) {
      const res = (v as { result?: unknown }).result;
      if (res === undefined || res === null || typeof res === "object") {
        if (res instanceof Date) return res;
        throw new FileParseError("Célula com fórmula sem valor calculado; salve a planilha no Excel antes de importar");
      }
      return res as RawCell;
    }
    if ("text" in v) return String((v as { text: unknown }).text);
    if ("error" in v) return null;
  }
  return String(v);
}

export async function parseXlsx(bytes: Uint8Array): Promise<ParsedFile> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch {
    throw new FileParseError("XLSX inválido ou protegido por senha");
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new FileParseError("Planilha vazia");
  if (ws.rowCount - 1 > MAX_IMPORT_ROWS) throw new FileParseError(`Mais de ${MAX_IMPORT_ROWS} linhas; divida o arquivo`);
  const headerRow = ws.getRow(1);
  const width = Math.min(headerRow.cellCount, MAX_IMPORT_COLUMNS + 1);
  const rawHeaders: unknown[] = [];
  for (let c = 1; c <= width; c++) rawHeaders.push(cellValue(headerRow.getCell(c).value));
  while (rawHeaders.length && (rawHeaders[rawHeaders.length - 1] === null || rawHeaders[rawHeaders.length - 1] === "")) rawHeaders.pop();
  const headers = normalizeHeaders(rawHeaders);
  const rows: RawRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const xr = ws.getRow(r);
    const row: RawRow = {};
    let empty = true;
    headers.forEach((h, i) => {
      const v = cellValue(xr.getCell(i + 1).value);
      const clean = typeof v === "string" && v.trim() === "" ? null : v;
      if (clean !== null) empty = false;
      row[h] = clean;
    });
    if (!empty) rows.push(row);
  }
  return { headers, rows, sheetName: ws.name };
}

export async function parseImportFile(extension: "csv" | "xlsx", bytes: Uint8Array): Promise<ParsedFile> {
  const parsed = extension === "csv" ? parseCsv(bytes) : await parseXlsx(bytes);
  if (parsed.rows.length === 0) throw new FileParseError("Arquivo sem linhas de dados");
  return parsed;
}

/** raw_data é JSONB: Date vira ISO string marcada para ser reconstruída na normalização. */
export function toStoredRaw(row: RawRow): Record<string, string | number | boolean | null | { $date: string }> {
  const out: Record<string, string | number | boolean | null | { $date: string }> = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? { $date: v.toISOString() } : v;
  return out;
}

export function fromStoredRaw(raw: Record<string, unknown>): RawRow {
  const out: RawRow = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v && typeof v === "object" && "$date" in (v as object)) out[k] = new Date((v as { $date: string }).$date);
    else out[k] = (v as RawCell) ?? null;
  }
  return out;
}
