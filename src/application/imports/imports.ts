import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  IMPORT_NORMALIZATION_ENGINE,
  MAPPABLE_FIELDS,
  assignDedupKeys,
  normalizeRow,
  rawRowHash,
  type ColumnMapping,
  type ImportOptions,
  type ImportType,
  type NormalizedRow,
} from "@/domain/imports/normalization";
import { isCompetence } from "@/domain/competence";
import {
  ENTITY_RESOLUTION_ENGINE,
  resolveCustomer,
  sourceKeyOf,
  type ResolutionResult,
} from "@/domain/entity-resolution/entity-resolution";
import { setAuditIntent, type Tx } from "@/infrastructure/db/client";
import { putObject } from "@/infrastructure/storage/storage";
import { assertUuid, requirePermission, userTx, type OrgContext } from "../context";
import { AppError, fromDbError, invalid, notFound } from "../errors";
import { validateUpload, type UploadedFile } from "../files";
import { FileParseError, fromStoredRaw, parseImportFile, toStoredRaw } from "./file-parser";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------------------

export interface UploadResult {
  importId: string;
  status: string;
  duplicateOf: string | null;
  rowCount: number;
}

export async function uploadImport(
  ctx: OrgContext,
  input: { type: ImportType; file: UploadedFile; sourceSystem?: string | null; stored?: { path: string; id: string } },
): Promise<UploadResult> {
  requirePermission(ctx, "imports.write");
  if (input.type !== "OPERATIONAL" && input.type !== "BILLING") throw invalid("Tipo de importação inválido");
  const file = validateUpload(input.file, ["csv", "xlsx"]);
  const ext = file.extension as "csv" | "xlsx";
  const sourceSystem = input.sourceSystem?.trim().slice(0, 100) || null;

  // 1. Arquivo idêntico já importado ⇒ registro DUPLICATE (detectável, auditado, sem reprocessar).
  const original = await userTx(ctx, async (tx) => {
    const [o] = await tx`select id, storage_path from app.imports where organization_id = ${ctx.orgId} and type = ${input.type}
                         and sha256_hash = ${file.sha256} and status not in ('DUPLICATE', 'FAILED')`;
    return o;
  });
  if (original) {
    const id = await userTx(ctx, async (tx) => {
      await setAuditIntent(tx, "import.duplicate_detected");
      const [r] = await tx`
        insert into app.imports (organization_id, type, file_name, file_format, storage_path, mime_type, file_size, sha256_hash,
          source_system, status, duplicate_of_import_id, uploaded_by, completed_at)
        values (${ctx.orgId}, ${input.type}, ${file.fileName}, ${ext.toUpperCase()}, ${original.storage_path}, ${file.mimeType},
          ${file.size}, ${file.sha256}, ${sourceSystem}, 'DUPLICATE', ${original.id}, ${ctx.userId}, now())
        returning id`;
      return r!.id as string;
    });
    return { importId: id, status: "DUPLICATE", duplicateOf: original.id as string, rowCount: 0 };
  }

  const id = input.stored?.id ?? randomUUID();
  const path = input.stored?.path ?? `${ctx.orgId}/${id}.${ext}`;
  if (path !== `${ctx.orgId}/${id}.${ext}`) throw invalid("Caminho de armazenamento inválido");
  if (!input.stored) await putObject("imports", path, file.bytes, file.mimeType);

  let parsed: Awaited<ReturnType<typeof parseImportFile>> | null = null;
  let parseError: string | null = null;
  try {
    parsed = await parseImportFile(ext, file.bytes);
  } catch (e) {
    if (!(e instanceof FileParseError)) throw e;
    parseError = e.message;
  }

  try {
    await userTx(ctx, async (tx) => {
      await setAuditIntent(tx, "import.upload");
      await tx`
        insert into app.imports (id, organization_id, type, file_name, file_format, storage_path, mime_type, file_size, sha256_hash,
          source_system, headers, parse_options, status, row_count, uploaded_by, completed_at, error_summary)
        values (${id}, ${ctx.orgId}, ${input.type}, ${file.fileName}, ${ext.toUpperCase()}, ${path}, ${file.mimeType}, ${file.size},
          ${file.sha256}, ${sourceSystem}, ${parsed ? tx.json(parsed.headers) : null},
          ${tx.json({ encoding: parsed?.encoding ?? null, delimiter: parsed?.delimiter ?? null, sheet: parsed?.sheetName ?? null })},
          ${parsed ? "MAPPING_REQUIRED" : "FAILED"}, ${parsed?.rows.length ?? 0}, ${ctx.userId},
          ${parsed ? null : tx`now()`}, ${parseError ? tx.json({ message: parseError }) : null})`;
      if (parsed) {
        const rows = parsed.rows.map((r, i) => ({
          organization_id: ctx.orgId,
          import_id: id,
          row_number: i + 1,
          raw_data: toStoredRaw(r),
          row_hash: rawRowHash(r),
        }));
        for (let i = 0; i < rows.length; i += 1000) {
          await tx`insert into app.import_rows ${tx(rows.slice(i, i + 1000) as never, "organization_id", "import_id", "row_number", "raw_data", "row_hash")}`;
        }
      }
    });
  } catch (e) {
    throw fromDbError(e);
  }
  logger.info("import.uploaded", { org: ctx.orgId, import: id, rows: parsed?.rows.length ?? 0, failed: !!parseError });
  if (parseError) throw invalid(`Arquivo não pôde ser lido: ${parseError}`);
  return { importId: id, status: "MAPPING_REQUIRED", duplicateOf: null, rowCount: parsed!.rows.length };
}

// ---------------------------------------------------------------------------------------
// Mapeamento, preview e validação
// ---------------------------------------------------------------------------------------

const MappingSchema = z.partialRecord(z.enum(MAPPABLE_FIELDS), z.string().min(1).max(120)).transform((m) => m as ColumnMapping);
const OptionsSchema = z.object({
  numberFormat: z.enum(["BR", "US"]),
  competence: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("COLUMN") }),
    z.object({ mode: z.literal("FIXED"), competence: z.string().refine(isCompetence, "competência inválida (AAAA-MM-01)") }),
    z.object({ mode: z.literal("FROM_DATE"), offsetMonths: z.number().int().min(0).max(12) }),
  ]),
  defaultUnit: z.string().optional(),
  defaultEventType: z.string().max(100).optional(),
});

export function validateMapping(type: ImportType, headers: string[], mappingInput: unknown, optionsInput: unknown): { mapping: ColumnMapping; options: ImportOptions } {
  const m = MappingSchema.safeParse(mappingInput);
  if (!m.success) throw invalid("Mapeamento inválido");
  const o = OptionsSchema.safeParse(optionsInput);
  if (!o.success) throw invalid(o.error.issues[0]?.message ?? "Opções inválidas");
  const mapping = Object.fromEntries(Object.entries(m.data).filter(([, v]) => v)) as ColumnMapping;
  for (const col of Object.values(mapping)) if (!headers.includes(col!)) throw invalid(`Coluna inexistente no arquivo: ${col}`);
  const missing: string[] = [];
  if (!mapping.cnpj && !mapping.customer_name && !mapping.external_customer_id) missing.push("identificação do cliente (CNPJ, nome ou ID externo)");
  if (o.data.competence.mode === "COLUMN" && !mapping.competence) missing.push("competência (ou escolha uma regra de competência)");
  if (o.data.competence.mode === "FROM_DATE" && !mapping.date) missing.push("data (necessária para derivar a competência)");
  if (type === "OPERATIONAL") {
    if (!mapping.quantity) missing.push("quantidade");
    if (!mapping.unit && !o.data.defaultUnit) missing.push("unidade (coluna ou unidade padrão)");
    if (!mapping.event_type && !o.data.defaultEventType?.trim()) missing.push("tipo de evento (coluna ou padrão)");
  } else {
    if (!mapping.amount) missing.push("valor");
    if (!mapping.date) missing.push("data de emissão");
  }
  if (missing.length) throw invalid(`Mapeamento incompleto: ${missing.join("; ")}`);
  return { mapping, options: o.data as ImportOptions };
}

/** Sugestão (não aplicada automaticamente) a partir dos nomes das colunas. */
export function suggestMapping(type: ImportType, headers: string[]): ColumnMapping {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const patterns: Array<[keyof ColumnMapping, RegExp]> = [
    ["cnpj", /\bcnpj\b/],
    ["external_customer_id", /\b(id|codigo|cod) (do )?cliente\b|\bcliente id\b/],
    ["customer_name", /\b(cliente|razao social|tomador|nome)\b/],
    ["contract_number", /\bcontrato\b/],
    ["competence", /\b(competencia|mes referencia|referencia|periodo)\b/],
    ["date", /\b(data|emissao|dt)\b/],
    ["description", /\b(descricao|historico|servico)\b/],
    ["quantity", /\b(horas|quantidade|qtd|qtde|unidades)\b/],
    ["unit", /\bunidade\b/],
    ["event_type", /\btipo\b/],
    ["amount", /\b(valor|total|montante)\b/],
    ["document_number", /\b(nf|nfse|nota|numero|documento)\b/],
    ["series", /\bserie\b/],
    ["external_event_id", /\b(os|ordem|chamado|ticket|id evento)\b/],
  ];
  const out: ColumnMapping = {};
  const used = new Set<string>();
  for (const [field, re] of patterns) {
    if (type === "OPERATIONAL" && ["amount", "document_number", "series"].includes(field)) continue;
    if (type === "BILLING" && ["quantity", "unit", "event_type"].includes(field)) continue;
    const h = headers.find((x) => !used.has(x) && re.test(norm(x)));
    if (h) {
      out[field] = h;
      used.add(h);
    }
  }
  return out;
}

export async function previewImport(ctx: OrgContext, importId: string, mappingInput: unknown, optionsInput: unknown, limit = 20) {
  requirePermission(ctx, "imports.write");
  assertUuid(importId);
  return userTx(ctx, async (tx) => {
    const [imp] = await tx`select type, headers, status from app.imports where id = ${importId} and organization_id = ${ctx.orgId}`;
    if (!imp) throw notFound("Import");
    const { mapping, options } = validateMapping(imp.type, imp.headers as string[], mappingInput, optionsInput);
    const rows = await tx`select row_number, raw_data from app.import_rows where import_id = ${importId} order by row_number limit ${limit}`;
    return rows.map((r) => ({ rowNumber: r.row_number as number, result: normalizeRow(imp.type, fromStoredRaw(r.raw_data), mapping, options) }));
  });
}

// ---------------------------------------------------------------------------------------
// Processamento
// ---------------------------------------------------------------------------------------

interface RowUpdate {
  id: string;
  normalized_data: unknown;
  status: string;
  errors: unknown;
  error_message: string | null;
  dedup_key: string | null;
  customer_source_key: string | null;
  entity_match_id: string | null;
  target_entity_type: string | null;
  target_entity_id: string | null;
}

async function applyRowUpdates(tx: Tx, orgId: string, updates: RowUpdate[]): Promise<void> {
  for (let i = 0; i < updates.length; i += 1000) {
    const batch = updates.slice(i, i + 1000);
    await tx`
      update app.import_rows r set normalized_data = v.normalized_data, status = v.status, errors = v.errors,
        error_message = v.error_message, dedup_key = v.dedup_key, customer_source_key = v.customer_source_key,
        entity_match_id = v.entity_match_id, target_entity_type = v.target_entity_type, target_entity_id = v.target_entity_id
      from jsonb_to_recordset(${tx.json(batch as never)}) as v(id uuid, normalized_data jsonb, status text, errors jsonb,
        error_message text, dedup_key text, customer_source_key text, entity_match_id uuid, target_entity_type text, target_entity_id uuid)
      where r.id = v.id and r.organization_id = ${orgId}`;
  }
}

interface MatchHandle {
  matchId: string;
  status: ResolutionResult["status"];
  customerId: string | null;
  confidence: string | null;
}

/** Registra a decisão do motor de resolução em entity_matches (idempotente por chave). */
async function persistResolution(tx: Tx, orgId: string, r: ResolutionResult): Promise<MatchHandle> {
  if (r.method === "PREVIOUS_MATCH" && r.previousMatchId) {
    return { matchId: r.previousMatchId, status: "MATCHED", customerId: r.customerId, confidence: r.confidence };
  }
  const [existing] = await tx`
    select id, status, candidate_customer_id, entity_match_confidence from app.entity_matches
    where organization_id = ${orgId} and entity_type = 'CUSTOMER' and source_key = ${r.sourceKey}
      and candidate_customer_id is not distinct from ${r.customerId} and status <> 'REJECTED'`;
  if (existing) {
    return { matchId: existing.id, status: existing.status, customerId: existing.candidate_customer_id, confidence: existing.entity_match_confidence };
  }
  const [row] = await tx`
    insert into app.entity_matches (organization_id, source_key, source_label, candidate_customer_id, status, method,
      entity_match_confidence, engine_version)
    values (${orgId}, ${r.sourceKey}, ${r.sourceLabel.slice(0, 300)}, ${r.customerId}, ${r.status}, ${r.method}, ${r.confidence},
      ${ENTITY_RESOLUTION_ENGINE.version})
    returning id`;
  return { matchId: row!.id as string, status: r.status, customerId: r.customerId, confidence: r.confidence };
}

interface Materializable {
  rowId: string;
  importId: string;
  importType: ImportType;
  data: NormalizedRow;
  dedupKey: string;
  customerId: string;
  matchId: string;
  confidence: string | null;
}

/** Cria eventos para linhas com cliente MATCHED. Idempotente via dedup_key (ADR-008). */
async function materializeRows(tx: Tx, ctx: OrgContext, items: Materializable[]): Promise<Map<string, Partial<RowUpdate>>> {
  const result = new Map<string, Partial<RowUpdate>>();
  if (items.length === 0) return result;
  const contracts = await tx`select id, customer_id, contract_number from app.contracts where organization_id = ${ctx.orgId} and deleted_at is null`;
  const byNumber = new Map(contracts.map((c) => [c.contract_number as string, c]));

  const ready: Array<Materializable & { contractId: string | null }> = [];
  for (const it of items) {
    let contractId: string | null = null;
    if (it.data.contractNumber) {
      const k = byNumber.get(it.data.contractNumber);
      if (!k) {
        result.set(it.rowId, { status: "INVALID", error_message: `contrato "${it.data.contractNumber}" não encontrado` });
        continue;
      }
      if (k.customer_id !== it.customerId) {
        result.set(it.rowId, { status: "CONFLICT", error_message: `contrato "${it.data.contractNumber}" pertence a outro cliente` });
        continue;
      }
      contractId = k.id as string;
    }
    ready.push({ ...it, contractId });
  }

  const ops = ready.filter((r) => r.data.kind === "OPERATIONAL");
  const bills = ready.filter((r) => r.data.kind === "BILLING");

  for (let i = 0; i < ops.length; i += 500) {
    const chunk = ops.slice(i, i + 500).map((r) => {
      const d = r.data as Extract<NormalizedRow, { kind: "OPERATIONAL" }>;
      return {
        organization_id: ctx.orgId, customer_id: r.customerId, contract_id: r.contractId, competence: d.competence,
        event_date: d.eventDate, event_type: d.eventType, quantity: d.quantity, unit: d.unit, external_id: d.externalId,
        description: d.description, dedup_key: r.dedupKey, source_type: "OPERATIONAL_IMPORT", source_import_id: r.importId,
        source_import_row_id: r.rowId, entity_match_id: r.matchId, entity_match_confidence: r.confidence, created_by: ctx.userId,
      };
    });
    const inserted = await tx`
      insert into app.operational_events ${tx(chunk as never)}
      on conflict (organization_id, dedup_key) where status = 'ACTIVE' do nothing
      returning id, source_import_row_id`;
    const ins = new Map(inserted.map((x) => [x.source_import_row_id as string, x.id as string]));
    const missingKeys = chunk.filter((c) => !ins.has(c.source_import_row_id)).map((c) => c.dedup_key);
    const existing = missingKeys.length
      ? await tx`select id, dedup_key from app.operational_events where organization_id = ${ctx.orgId} and status = 'ACTIVE' and dedup_key in ${tx(missingKeys)}`
      : [];
    const ex = new Map(existing.map((x) => [x.dedup_key as string, x.id as string]));
    for (const c of chunk) {
      const newId = ins.get(c.source_import_row_id);
      result.set(c.source_import_row_id, newId
        ? { status: "IMPORTED", target_entity_type: "OPERATIONAL_EVENT", target_entity_id: newId }
        : { status: "DUPLICATE", target_entity_type: "OPERATIONAL_EVENT", target_entity_id: ex.get(c.dedup_key) ?? null, error_message: null });
    }
  }

  if (bills.length) {
    // Notas fiscais: mesmo número/série para outro cliente é conflito (nunca sobrescreve).
    const docs = [...new Map(bills.filter((b) => (b.data as { documentNumber: string | null }).documentNumber).map((b) => {
      const d = b.data as Extract<NormalizedRow, { kind: "BILLING" }>;
      return [`${d.series}|${d.documentNumber}`, { organization_id: ctx.orgId, customer_id: b.customerId, document_number: d.documentNumber!, series: d.series, issue_date: d.billingDate, source_import_id: b.importId }];
    })).values()];
    if (docs.length) await tx`insert into app.invoices ${tx(docs as never)} on conflict (organization_id, series, document_number) do nothing`;
    const invoices = docs.length
      ? await tx`select id, customer_id, series, document_number from app.invoices where organization_id = ${ctx.orgId}
                 and (series || '|' || document_number) in ${tx(docs.map((d) => `${d.series}|${d.document_number}`))}`
      : [];
    const invByKey = new Map(invoices.map((v) => [`${v.series}|${v.document_number}`, v]));

    const valid: Array<Record<string, unknown>> = [];
    for (const b of bills) {
      const d = b.data as Extract<NormalizedRow, { kind: "BILLING" }>;
      let invoiceId: string | null = null;
      if (d.documentNumber) {
        const inv = invByKey.get(`${d.series}|${d.documentNumber}`);
        if (!inv || inv.customer_id !== b.customerId) {
          result.set(b.rowId, { status: "CONFLICT", error_message: `NF ${d.documentNumber} já registrada para outro cliente` });
          continue;
        }
        invoiceId = inv.id as string;
      }
      valid.push({
        organization_id: ctx.orgId, customer_id: b.customerId, contract_id: b.contractId, competence: d.competence,
        billing_date: d.billingDate, document_number: d.documentNumber, invoice_id: invoiceId, description: d.description,
        amount: d.amount, external_id: d.externalId, dedup_key: b.dedupKey, source_type: "BILLING_IMPORT",
        source_import_id: b.importId, source_import_row_id: b.rowId, entity_match_id: b.matchId,
        entity_match_confidence: b.confidence, created_by: ctx.userId,
      });
    }
    for (let i = 0; i < valid.length; i += 500) {
      const chunk = valid.slice(i, i + 500);
      const inserted = await tx`
        insert into app.billing_events ${tx(chunk as never)}
        on conflict (organization_id, dedup_key) where status = 'ACTIVE' do nothing
        returning id, source_import_row_id`;
      const ins = new Map(inserted.map((x) => [x.source_import_row_id as string, x.id as string]));
      const missingKeys = chunk.filter((c) => !ins.has(c.source_import_row_id as string)).map((c) => c.dedup_key as string);
      const existing = missingKeys.length
        ? await tx`select id, dedup_key from app.billing_events where organization_id = ${ctx.orgId} and status = 'ACTIVE' and dedup_key in ${tx(missingKeys)}`
        : [];
      const ex = new Map(existing.map((x) => [x.dedup_key as string, x.id as string]));
      for (const c of chunk) {
        const newId = ins.get(c.source_import_row_id as string);
        result.set(c.source_import_row_id as string, newId
          ? { status: "IMPORTED", target_entity_type: "BILLING_EVENT", target_entity_id: newId }
          : { status: "DUPLICATE", target_entity_type: "BILLING_EVENT", target_entity_id: ex.get(c.dedup_key as string) ?? null });
      }
    }
  }
  return result;
}

async function refreshImportStatus(tx: Tx, orgId: string, importId: string): Promise<void> {
  const [c] = await tx`
    select count(*)::int as total,
      count(*) filter (where status in ('VALID','PENDING_MATCH','IMPORTED','DUPLICATE'))::int as valid,
      count(*) filter (where status in ('INVALID','CONFLICT'))::int as invalid,
      count(*) filter (where status = 'DUPLICATE')::int as duplicate,
      count(*) filter (where status = 'PENDING_MATCH')::int as pending,
      count(*) filter (where status = 'IMPORTED')::int as imported
    from app.import_rows where import_id = ${importId}`;
  const status = c!.pending > 0 ? "NEEDS_REVIEW" : c!.invalid > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED";
  await tx`
    update app.imports set valid_rows = ${c!.valid}, invalid_rows = ${c!.invalid}, duplicate_rows = ${c!.duplicate},
      pending_match_rows = ${c!.pending}, imported_rows = ${c!.imported}, status = ${status},
      completed_at = case when ${status} = 'NEEDS_REVIEW' then null else now() end
    where id = ${importId} and organization_id = ${orgId}`;
}

export async function processImport(ctx: OrgContext, importId: string, mappingInput: unknown, optionsInput: unknown): Promise<{ status: string }> {
  requirePermission(ctx, "imports.write");
  assertUuid(importId);
  const started = Date.now();
  try {
    return await userTx(ctx, async (tx) => {
      const [imp] = await tx`select * from app.imports where id = ${importId} and organization_id = ${ctx.orgId} for update`;
      if (!imp) throw notFound("Import");
      if (imp.status !== "MAPPING_REQUIRED") throw new AppError("INVALID_STATE", `Import já processado (${imp.status})`, 409);
      const type = imp.type as ImportType;
      const { mapping, options } = validateMapping(type, imp.headers as string[], mappingInput, optionsInput);
      await setAuditIntent(tx, "import.process");
      await tx`update app.imports set mapping = ${tx.json(mapping as never)}, parse_options = parse_options || ${tx.json(options as never)},
               mapping_version = mapping_version + 1, normalization_engine_version = ${IMPORT_NORMALIZATION_ENGINE.version},
               started_at = now() where id = ${importId}`;

      const rows = await tx`select id, row_number, raw_data from app.import_rows where import_id = ${importId} order by row_number`;
      const normalized = rows.map((r) => normalizeRow(type, fromStoredRaw(r.raw_data), mapping, options));
      const keys = assignDedupKeys(normalized.map((n) => (n.ok ? n.data : null)));

      // Resolução de entidades (uma decisão por chave de origem)
      const customers = await tx`select id, cnpj, external_id, legal_name_normalized, trade_name_normalized from app.customers
                                 where organization_id = ${ctx.orgId} and deleted_at is null`;
      const matches = await tx`select id, source_key, candidate_customer_id, status, entity_match_confidence from app.entity_matches
                               where organization_id = ${ctx.orgId} and status in ('MATCHED', 'REJECTED')`;
      const resolutionCtx = {
        customers: customers.map((c) => ({ id: c.id, cnpj: c.cnpj, externalId: c.external_id, legalNameNormalized: c.legal_name_normalized, tradeNameNormalized: c.trade_name_normalized })),
        confirmed: new Map(matches.filter((m) => m.status === "MATCHED").map((m) => [m.source_key as string, { matchId: m.id as string, customerId: m.candidate_customer_id as string, confidence: m.entity_match_confidence as string | null }])),
        rejected: new Set(matches.filter((m) => m.status === "REJECTED").map((m) => `${m.source_key}|${m.candidate_customer_id}`)),
      };
      const handles = new Map<string, MatchHandle>();

      const updates: RowUpdate[] = [];
      const toMaterialize: Materializable[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        const n = normalized[i]!;
        const base: RowUpdate = {
          id: row.id, normalized_data: null, status: "INVALID", errors: null, error_message: null, dedup_key: null,
          customer_source_key: null, entity_match_id: null, target_entity_type: null, target_entity_id: null,
        };
        if (!n.ok) {
          updates.push({ ...base, errors: n.errors, error_message: n.errors.map((e) => `${e.field}: ${e.message}`).join("; ").slice(0, 2000) });
          continue;
        }
        const src = sourceKeyOf(n.data.customer);
        if (!src) {
          updates.push({ ...base, normalized_data: n.data, error_message: "cliente não identificado" });
          continue;
        }
        let h = handles.get(src.key);
        if (!h) {
          const res = resolveCustomer(n.data.customer, resolutionCtx)!;
          h = await persistResolution(tx, ctx.orgId, res);
          handles.set(src.key, h);
        }
        const upd: RowUpdate = { ...base, normalized_data: n.data, dedup_key: keys[i]!, customer_source_key: src.key, entity_match_id: h.matchId, status: "PENDING_MATCH" };
        updates.push(upd);
        if (h.status === "MATCHED" && h.customerId) {
          toMaterialize.push({ rowId: row.id, importId, importType: type, data: n.data, dedupKey: keys[i]!, customerId: h.customerId, matchId: h.matchId, confidence: h.confidence });
        }
      }
      const outcomes = await materializeRows(tx, ctx, toMaterialize);
      for (const u of updates) {
        const o = outcomes.get(u.id);
        if (o) Object.assign(u, o);
      }
      await applyRowUpdates(tx, ctx.orgId, updates);
      await refreshImportStatus(tx, ctx.orgId, importId);
      const [fin] = await tx`select status, row_count, imported_rows, duplicate_rows, invalid_rows, pending_match_rows from app.imports where id = ${importId}`;
      logger.info("import.processed", { org: ctx.orgId, import: importId, ms: Date.now() - started, engine: IMPORT_NORMALIZATION_ENGINE.version, ...fin });
      return { status: fin!.status as string };
    });
  } catch (e) {
    throw fromDbError(e);
  }
}

// ---------------------------------------------------------------------------------------
// Decisão humana de entity match
// ---------------------------------------------------------------------------------------

const DecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CONFIRM") }),
  z.object({ action: z.literal("REJECT"), reason: z.string().trim().min(3).max(1000) }),
  z.object({ action: z.literal("ASSIGN"), customerId: z.string().uuid(), reason: z.string().trim().max(1000).optional() }),
]);

export async function decideEntityMatch(ctx: OrgContext, matchId: string, decisionInput: unknown): Promise<{ materialized: number }> {
  requirePermission(ctx, "matches.decide");
  assertUuid(matchId);
  const d = DecisionSchema.safeParse(decisionInput);
  if (!d.success) throw invalid("Decisão inválida");
  try {
    return await userTx(ctx, async (tx) => {
      const [m] = await tx`select * from app.entity_matches where id = ${matchId} and organization_id = ${ctx.orgId} for update`;
      if (!m) throw notFound("Vínculo");
      let matched: { id: string; customerId: string; confidence: string | null } | null = null;
      if (d.data.action === "CONFIRM") {
        if (m.status !== "PROPOSED") throw invalid("Só vínculos propostos podem ser confirmados");
        await setAuditIntent(tx, "entity_match.confirm");
        await tx`update app.entity_matches set status = 'MATCHED', decided_by = ${ctx.userId}, decided_at = now() where id = ${matchId}`;
        matched = { id: matchId, customerId: m.candidate_customer_id, confidence: m.entity_match_confidence };
      } else if (d.data.action === "REJECT") {
        if (m.status !== "PROPOSED") throw invalid("Só vínculos propostos podem ser rejeitados");
        await setAuditIntent(tx, "entity_match.reject");
        await tx`update app.entity_matches set status = 'REJECTED', decided_by = ${ctx.userId}, decided_at = now(),
                 decision_reason = ${d.data.reason} where id = ${matchId}`;
        // Linhas continuam pendentes, agora associadas a um registro UNMATCHED da mesma chave.
        const [un] = await tx`
          insert into app.entity_matches (organization_id, source_key, source_label, status, method, engine_version)
          values (${ctx.orgId}, ${m.source_key}, ${m.source_label}, 'UNMATCHED', 'NONE', ${ENTITY_RESOLUTION_ENGINE.version})
          on conflict (organization_id, entity_type, source_key, candidate_customer_id) do update set updated_at = now()
          returning id`;
        await tx`update app.import_rows set entity_match_id = ${un!.id} where organization_id = ${ctx.orgId}
                 and customer_source_key = ${m.source_key} and status = 'PENDING_MATCH'`;
        return { materialized: 0 };
      } else {
        const [c] = await tx`select id from app.customers where id = ${d.data.customerId} and organization_id = ${ctx.orgId} and deleted_at is null`;
        if (!c) throw notFound("Cliente");
        await setAuditIntent(tx, "entity_match.assign");
        if (m.status === "UNMATCHED") {
          await tx`update app.entity_matches set status = 'MATCHED', method = 'MANUAL', candidate_customer_id = ${d.data.customerId},
                   entity_match_confidence = 1, decided_by = ${ctx.userId}, decided_at = now(), decision_reason = ${d.data.reason ?? null}
                   where id = ${matchId}`;
          matched = { id: matchId, customerId: d.data.customerId, confidence: "1.0000" };
        } else {
          if (m.status === "PROPOSED") {
            await tx`update app.entity_matches set status = 'REJECTED', decided_by = ${ctx.userId}, decided_at = now(),
                     decision_reason = 'substituído por atribuição manual' where id = ${matchId}`;
          }
          const [nm] = await tx`
            insert into app.entity_matches (organization_id, source_key, source_label, candidate_customer_id, status, method,
              entity_match_confidence, engine_version, decided_by, decided_at, decision_reason)
            values (${ctx.orgId}, ${m.source_key}, ${m.source_label}, ${d.data.customerId}, 'MATCHED', 'MANUAL', 1,
              ${ENTITY_RESOLUTION_ENGINE.version}, ${ctx.userId}, now(), ${d.data.reason ?? null})
            returning id`;
          matched = { id: nm!.id as string, customerId: d.data.customerId, confidence: "1.0000" };
        }
      }

      // Materializa todas as linhas pendentes desta chave (em qualquer import da organização).
      const pending = await tx`
        select r.id, r.import_id, r.normalized_data, r.dedup_key, i.type from app.import_rows r join app.imports i on i.id = r.import_id
        where r.organization_id = ${ctx.orgId} and r.customer_source_key = ${m.source_key} and r.status = 'PENDING_MATCH'`;
      const outcomes = await materializeRows(tx, ctx, pending.map((p) => ({
        rowId: p.id, importId: p.import_id, importType: p.type, data: p.normalized_data as NormalizedRow, dedupKey: p.dedup_key,
        customerId: matched!.customerId, matchId: matched!.id, confidence: matched!.confidence,
      })));
      await applyRowUpdates(tx, ctx.orgId, pending.map((p) => ({
        id: p.id, normalized_data: p.normalized_data, errors: null, error_message: null, dedup_key: p.dedup_key,
        customer_source_key: m.source_key, entity_match_id: matched!.id, target_entity_type: null, target_entity_id: null,
        status: "PENDING_MATCH", ...outcomes.get(p.id),
      })));
      for (const importId of new Set(pending.map((p) => p.import_id as string))) await refreshImportStatus(tx, ctx.orgId, importId);
      return { materialized: pending.length };
    });
  } catch (e) {
    throw fromDbError(e);
  }
}

// ---------------------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------------------

export async function listImports(ctx: OrgContext) {
  requirePermission(ctx, "imports.read");
  return userTx(ctx, async (tx) => tx`
    select i.id, i.type, i.file_name, i.status, i.row_count, i.valid_rows, i.invalid_rows, i.duplicate_rows, i.pending_match_rows,
      i.imported_rows, i.created_at, i.duplicate_of_import_id, u.email as uploader_email
    from app.imports i left join app.users u on u.id = i.uploaded_by
    where i.organization_id = ${ctx.orgId} order by i.created_at desc limit 200`);
}

export async function getImport(ctx: OrgContext, importId: string, opts: { rowStatus?: string; page?: number } = {}) {
  requirePermission(ctx, "imports.read");
  assertUuid(importId);
  return userTx(ctx, async (tx) => {
    const [imp] = await tx`select i.*, u.email as uploader_email from app.imports i left join app.users u on u.id = i.uploaded_by
                           where i.id = ${importId} and i.organization_id = ${ctx.orgId}`;
    if (!imp) throw notFound("Import");
    const page = Math.max(0, opts.page ?? 0);
    const rows = await tx`
      select id, row_number, raw_data, normalized_data, status, error_message, target_entity_type, target_entity_id, customer_source_key
      from app.import_rows where import_id = ${importId}
        and (${opts.rowStatus ?? null}::text is null or status = ${opts.rowStatus ?? null})
      order by row_number limit 100 offset ${page * 100}`;
    const pendingMatches = await tx`
      select m.id, m.source_key, m.source_label, m.status, m.method, m.entity_match_confidence, m.candidate_customer_id,
        c.legal_name as candidate_name, c.cnpj as candidate_cnpj,
        (select count(*)::int from app.import_rows r where r.entity_match_id = m.id and r.status = 'PENDING_MATCH') as rows
      from app.entity_matches m left join app.customers c on c.id = m.candidate_customer_id
      where m.organization_id = ${ctx.orgId} and m.status in ('PROPOSED', 'UNMATCHED')
        and exists (select 1 from app.import_rows r where r.entity_match_id = m.id and r.import_id = ${importId} and r.status = 'PENDING_MATCH')
      order by m.source_label`;
    return { import: imp, rows, pendingMatches };
  });
}
