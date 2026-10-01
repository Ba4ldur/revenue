import { randomUUID } from "node:crypto";
import { extractText, getDocumentProxy } from "unpdf";
import { sha256Hex } from "@/domain/hashing";
import { setAuditIntent } from "@/infrastructure/db/client";
import { putObject, signedUrl } from "@/infrastructure/storage/storage";
import { assertUuid, requirePermission, userTx, type OrgContext } from "./context";
import { AppError, fromDbError, invalid, notFound } from "./errors";
import { validateUpload, type UploadedFile } from "./files";
import { logger } from "@/lib/logger";

export const DOCUMENT_TYPES = ["CONTRACT", "AMENDMENT", "PROPOSAL", "PRICE_TABLE", "SLA", "OTHER"] as const;

export interface ContractDocument {
  id: string;
  contractId: string;
  contractVersionId: string | null;
  fileName: string;
  fileSize: number;
  sha256: string;
  documentType: string;
  pageCount: number | null;
  textStatus: string;
  uploadedAt: string;
  uploadedByEmail: string | null;
}

export function mapDocument(r: Record<string, unknown>): ContractDocument {
  return {
    id: r.id as string,
    contractId: r.contract_id as string,
    contractVersionId: (r.contract_version_id as string | null) ?? null,
    fileName: r.file_name as string,
    fileSize: Number(r.file_size),
    sha256: r.sha256_hash as string,
    documentType: r.document_type as string,
    pageCount: (r.page_count as number | null) ?? null,
    textStatus: r.text_status as string,
    uploadedAt: new Date(r.uploaded_at as string).toISOString(),
    uploadedByEmail: (r.uploader_email as string | null) ?? null,
  };
}

/** Texto por página — base da proveniência (página + trecho literal). */
export async function extractPdfPages(bytes: Uint8Array): Promise<{ pages: string[]; error: string | null }> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    return { pages: text.map((t) => t.replace(/\u0000/g, "")), error: null };
  } catch (e) {
    return { pages: [], error: (e as Error).message.slice(0, 500) };
  }
}

export async function uploadContractDocument(
  ctx: OrgContext,
  input: { contractId: string; contractVersionId: string | null; documentType: string; file: UploadedFile },
): Promise<{ documentId: string; duplicate: boolean }> {
  requirePermission(ctx, "documents.write");
  assertUuid(input.contractId, "contrato");
  if (input.contractVersionId) assertUuid(input.contractVersionId, "versão");
  if (!(DOCUMENT_TYPES as readonly string[]).includes(input.documentType)) throw invalid("Tipo de documento inválido");
  const file = validateUpload(input.file, ["pdf"]);

  const existing = await userTx(ctx, async (tx) => {
    const [k] = await tx`select id from app.contracts where id = ${input.contractId} and organization_id = ${ctx.orgId}`;
    if (!k) throw notFound("Contrato");
    const [d] = await tx`select id from app.contract_documents where contract_id = ${input.contractId}
                          and sha256_hash = ${file.sha256} and deleted_at is null`;
    return d?.id as string | undefined;
  });
  if (existing) return { documentId: existing, duplicate: true };

  const id = randomUUID();
  const path = `${ctx.orgId}/${id}.pdf`;
  await putObject("contract-documents", path, file.bytes, file.mimeType);
  const { pages, error } = await extractPdfPages(file.bytes);
  const hasText = pages.some((p) => p.trim().length > 0);
  const textStatus = error ? "FAILED" : hasText ? "COMPLETED" : "NO_TEXT";
  logger.info("document.uploaded", { org: ctx.orgId, document: id, pages: pages.length, textStatus });

  try {
    await userTx(ctx, async (tx) => {
      await setAuditIntent(tx, "document.upload");
      await tx`
        insert into app.contract_documents (id, organization_id, contract_id, contract_version_id, storage_path, file_name,
          mime_type, file_size, sha256_hash, document_type, page_count, text_status, text_error, uploaded_by)
        values (${id}, ${ctx.orgId}, ${input.contractId}, ${input.contractVersionId}, ${path}, ${file.fileName},
          ${file.mimeType}, ${file.size}, ${file.sha256}, ${input.documentType}, ${pages.length}, ${textStatus}, ${error}, ${ctx.userId})`;
      if (textStatus === "COMPLETED") {
        for (let i = 0; i < pages.length; i++) {
          const text = pages[i]!;
          await tx`insert into app.contract_document_pages (organization_id, document_id, page_number, text, text_sha256)
                   values (${ctx.orgId}, ${id}, ${i + 1}, ${text}, ${sha256Hex(text)})`;
        }
      }
    });
  } catch (e) {
    throw fromDbError(e);
  }
  return { documentId: id, duplicate: false };
}

export async function listContractDocuments(ctx: OrgContext, contractId: string): Promise<ContractDocument[]> {
  return userTx(ctx, async (tx) => {
    const rows = await tx`
      select d.*, u.email as uploader_email from app.contract_documents d left join app.users u on u.id = d.uploaded_by
      where d.contract_id = ${contractId} and d.organization_id = ${ctx.orgId} and d.deleted_at is null
      order by d.uploaded_at`;
    return rows.map(mapDocument);
  });
}

export async function getDocumentPages(ctx: OrgContext, documentId: string): Promise<Array<{ pageNumber: number; text: string }>> {
  assertUuid(documentId);
  return userTx(ctx, async (tx) => {
    const rows = await tx`select page_number, text from app.contract_document_pages
                          where document_id = ${documentId} and organization_id = ${ctx.orgId} order by page_number`;
    return rows.map((r) => ({ pageNumber: r.page_number as number, text: r.text as string }));
  });
}

/** Signed URL de 60 s, emitida somente após checagem de papel + RLS; download fica auditado. */
export async function getDocumentDownloadUrl(ctx: OrgContext, documentId: string): Promise<string> {
  requirePermission(ctx, "documents.download");
  assertUuid(documentId);
  const doc = await userTx(ctx, async (tx) => {
    const [d] = await tx`select id, storage_path, file_name from app.contract_documents
                         where id = ${documentId} and organization_id = ${ctx.orgId}`;
    if (!d) throw notFound("Documento");
    await tx`select app.write_audit(${ctx.orgId}, 'document.download', 'contract_documents', ${documentId}, null)`;
    return d;
  });
  try {
    return await signedUrl("contract-documents", doc.storage_path as string, 60);
  } catch (e) {
    logger.error("document.sign_failed", { org: ctx.orgId, document: documentId, error: (e as Error).message });
    throw new AppError("STORAGE", "Não foi possível gerar o link do documento", 502);
  }
}
