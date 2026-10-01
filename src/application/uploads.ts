import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createSignedUpload, getObject, removeObject, type Bucket } from "@/infrastructure/storage/storage";
import { assertUuid, requirePermission, userTx, type OrgContext } from "./context";
import { AppError, invalid, notFound } from "./errors";
import { validateDeclared, validateUpload } from "./files";
import { DOCUMENT_TYPES, uploadContractDocument } from "./documents";
import { uploadImport, type UploadResult } from "./imports/imports";
import { logger } from "@/lib/logger";

/**
 * Upload direto ao Supabase Storage com URL assinada (o arquivo não passa pela função serverless).
 *
 * 1. createUploadIntent: autoriza (papel + RLS), pré-valida nome/tamanho/MIME declarados, gera o path
 *    `{organização}/{uuid}.{ext}` e devolve a URL assinada de upload + um token de intenção assinado
 *    com HMAC (organização, usuário, tipo, destino, path, expiração).
 * 2. O navegador envia o arquivo diretamente ao bucket privado (limites de tamanho/MIME do bucket se aplicam).
 * 3. finalizeUpload: confere o HMAC e a expiração, baixa o objeto e revalida o conteúdo real (magic bytes,
 *    tamanho, SHA-256) antes de registrar. Objeto rejeitado ou duplicado é removido do Storage.
 */

const INTENT_TTL_MS = 15 * 60 * 1000;

const IntentPayload = z.object({
  v: z.literal(1),
  kind: z.enum(["CONTRACT_DOCUMENT", "IMPORT"]),
  org: z.string().uuid(),
  user: z.string().uuid(),
  bucket: z.enum(["contract-documents", "imports"]),
  path: z.string(),
  fileName: z.string(),
  mime: z.string(),
  contractId: z.string().uuid().nullable(),
  versionId: z.string().uuid().nullable(),
  documentType: z.string().nullable(),
  importType: z.enum(["OPERATIONAL", "BILLING"]).nullable(),
  sourceSystem: z.string().nullable(),
  exp: z.number().int(),
});
type IntentPayload = z.infer<typeof IntentPayload>;

function secret(): Buffer {
  const s = process.env.UPLOAD_SIGNING_SECRET;
  if (!s || s.length < 32) throw new AppError("CONFIG", "Upload indisponível: UPLOAD_SIGNING_SECRET não configurada", 500);
  return Buffer.from(s, "utf8");
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

export function encodeIntent(p: IntentPayload): string {
  const body = Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

export function decodeIntent(token: string, now = Date.now()): IntentPayload {
  const [body, mac] = token.split(".");
  if (!body || !mac) throw invalid("Upload inválido");
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw invalid("Upload inválido (assinatura)");
  const parsed = IntentPayload.safeParse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
  if (!parsed.success) throw invalid("Upload inválido");
  if (parsed.data.exp < now) throw invalid("Upload expirado; envie o arquivo novamente");
  return parsed.data;
}

export interface UploadTicket {
  intent: string;
  bucket: Bucket;
  path: string;
  token: string;
  /** Content-Type canônico a enviar (o bucket só aceita os tipos permitidos). */
  contentType: string;
}

const IntentInput = z.object({
  kind: z.enum(["CONTRACT_DOCUMENT", "IMPORT"]),
  fileName: z.string().min(1).max(500),
  size: z.number().int(),
  mime: z.string().max(200),
  contractId: z.string().optional().nullable(),
  versionId: z.string().optional().nullable(),
  documentType: z.string().optional().nullable(),
  importType: z.enum(["OPERATIONAL", "BILLING"]).optional().nullable(),
  sourceSystem: z.string().max(100).optional().nullable(),
});

export async function createUploadIntent(ctx: OrgContext, input: unknown): Promise<UploadTicket> {
  const p = IntentInput.safeParse(input);
  if (!p.success) throw invalid("Dados do upload inválidos");
  const d = p.data;
  let bucket: Bucket;
  let declared: ReturnType<typeof validateDeclared>;
  if (d.kind === "CONTRACT_DOCUMENT") {
    requirePermission(ctx, "documents.write");
    const contractId = assertUuid(d.contractId ?? "", "contrato");
    if (d.versionId) assertUuid(d.versionId, "versão");
    if (!(DOCUMENT_TYPES as readonly string[]).includes(d.documentType ?? "")) throw invalid("Tipo de documento inválido");
    declared = validateDeclared(d.fileName, d.size, d.mime, ["pdf"]);
    // Contrato precisa existir e ser visível (RLS) antes de emitir a URL.
    await userTx(ctx, async (tx) => {
      const [k] = await tx`select id from app.contracts where id = ${contractId} and organization_id = ${ctx.orgId}`;
      if (!k) throw notFound("Contrato");
    });
    bucket = "contract-documents";
  } else {
    requirePermission(ctx, "imports.write");
    if (!d.importType) throw invalid("Tipo de importação inválido");
    declared = validateDeclared(d.fileName, d.size, d.mime, ["csv", "xlsx"]);
    bucket = "imports";
  }
  const path = `${ctx.orgId}/${randomUUID()}.${declared.extension}`;
  const signed = await createSignedUpload(bucket, path);
  const intent = encodeIntent({
    v: 1, kind: d.kind, org: ctx.orgId, user: ctx.userId, bucket, path, fileName: declared.fileName, mime: declared.canonicalMime,
    contractId: d.kind === "CONTRACT_DOCUMENT" ? d.contractId! : null, versionId: d.kind === "CONTRACT_DOCUMENT" ? d.versionId ?? null : null,
    documentType: d.kind === "CONTRACT_DOCUMENT" ? d.documentType! : null, importType: d.kind === "IMPORT" ? d.importType! : null,
    sourceSystem: d.kind === "IMPORT" ? d.sourceSystem?.trim() || null : null, exp: Date.now() + INTENT_TTL_MS,
  });
  logger.info("upload.intent", { org: ctx.orgId, kind: d.kind, bucket });
  return { intent, bucket, path, token: signed.token, contentType: declared.canonicalMime };
}

export type FinalizeResult =
  | { kind: "CONTRACT_DOCUMENT"; documentId: string; duplicate: boolean }
  | { kind: "IMPORT"; result: UploadResult };

export async function finalizeUpload(ctx: OrgContext, intentToken: string): Promise<FinalizeResult> {
  const intent = decodeIntent(intentToken);
  if (intent.org !== ctx.orgId || intent.user !== ctx.userId) throw invalid("Upload pertence a outra sessão");
  if (!intent.path.startsWith(`${ctx.orgId}/`)) throw invalid("Upload inválido");

  let bytes: Uint8Array;
  try {
    bytes = await getObject(intent.bucket, intent.path);
  } catch {
    throw invalid("Arquivo não encontrado no armazenamento; o envio não foi concluído");
  }
  const discard = async (reason: string) => {
    await removeObject(intent.bucket, intent.path).catch((e: Error) =>
      logger.warn("upload.remove_failed", { org: ctx.orgId, bucket: intent.bucket, error: e.message.slice(0, 200) }));
    logger.info("upload.discarded", { org: ctx.orgId, bucket: intent.bucket, reason });
  };
  // Revalidação do conteúdo real (não confia no que o navegador declarou).
  try {
    validateUpload({ name: intent.fileName, type: intent.mime, bytes }, intent.kind === "CONTRACT_DOCUMENT" ? ["pdf"] : ["csv", "xlsx"]);
  } catch (e) {
    await discard("invalid_content");
    throw e;
  }
  const stored = { path: intent.path, id: intent.path.split("/")[1]!.split(".")[0]! };
  try {
    if (intent.kind === "CONTRACT_DOCUMENT") {
      const r = await uploadContractDocument(ctx, {
        contractId: intent.contractId!, contractVersionId: intent.versionId, documentType: intent.documentType!,
        file: { name: intent.fileName, type: intent.mime, bytes }, stored,
      });
      if (r.duplicate) await discard("duplicate");
      return { kind: "CONTRACT_DOCUMENT", ...r };
    }
    const r = await uploadImport(ctx, { type: intent.importType!, file: { name: intent.fileName, type: intent.mime, bytes }, sourceSystem: intent.sourceSystem, stored });
    // Arquivo idêntico já importado: o registro DUPLICATE aponta para o arquivo original.
    if (r.status === "DUPLICATE") await discard("duplicate");
    return { kind: "IMPORT", result: r };
  } catch (e) {
    // Falha antes do registro: o objeto não fica órfão. (Import com arquivo ilegível é registrado como FAILED e mantém o arquivo.)
    if (!(e instanceof AppError && e.code === "VALIDATION" && intent.kind === "IMPORT")) await discard("register_failed");
    throw e;
  }
}
