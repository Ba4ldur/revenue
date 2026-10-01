import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { closePool } from "@/infrastructure/db/client";
import type { OrgContext, Role } from "@/application/context";
import { createUploadIntent, finalizeUpload } from "@/application/uploads";
import { createCustomer } from "@/application/customers";
import { createContract } from "@/application/contracts";
import { adminSql, createOrg, makeCnpj, type OrgFixture } from "./helpers";
import { CANONICAL_CONTRACT_PAGES, makeTextPdf } from "../support/pdf";

/** Upload direto ao Storage real (Supabase local) com URL assinada + revalidação no servidor. */
let A: OrgFixture;
let B: OrgFixture;
let contractId: string;
const ctx = (o: OrgFixture, role: Role = "ADMIN"): OrgContext => ({ userId: o.members[role], orgId: o.orgId, role, orgName: "x" });
const anon = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function browserUpload(t: { bucket: string; path: string; token: string; contentType: string }, bytes: Uint8Array) {
  // Igual ao componente do navegador: reembala com o tipo canônico.
  return anon().storage.from(t.bucket).uploadToSignedUrl(t.path, t.token, new Blob([bytes as BlobPart], { type: t.contentType }), { contentType: t.contentType });
}
async function exists(bucket: string, path: string) {
  const dir = path.split("/")[0]!;
  const { data } = await admin().storage.from(bucket).list(dir, { search: path.split("/")[1] });
  return (data ?? []).length > 0;
}

beforeAll(async () => {
  A = await createOrg("UpA");
  B = await createOrg("UpB");
  const customerId = await createCustomer(ctx(A), { legalName: "Cliente Upload S.A.", cnpj: makeCnpj(Date.now() % 89_999_999) });
  contractId = (await createContract(ctx(A), { customerId, contractNumber: `UP-${Date.now()}`, title: "Upload", startDate: "2026-01-01" })).contractId;
});
afterAll(async () => {
  await closePool();
});

describe("Upload direto com URL assinada", () => {
  it("PDF: intenção → upload pelo navegador (chave anônima) → finalização registra documento com texto", async () => {
    const pdf = makeTextPdf(CANONICAL_CONTRACT_PAGES);
    const t = await createUploadIntent(ctx(A, "COMMERCIAL"), { kind: "CONTRACT_DOCUMENT", fileName: "Contrato real.pdf", size: pdf.length, mime: "application/pdf", contractId, documentType: "CONTRACT" });
    expect(t.path).toMatch(new RegExp(`^${A.orgId}/[0-9a-f-]{36}\\.pdf$`));
    expect((await browserUpload(t, pdf)).error).toBeNull();
    const r = await finalizeUpload(ctx(A, "COMMERCIAL"), t.intent);
    expect(r).toMatchObject({ kind: "CONTRACT_DOCUMENT", duplicate: false });
    const [doc] = await adminSql()`select storage_path, file_name, text_status, page_count from app.contract_documents where id = ${(r as { documentId: string }).documentId}`;
    expect(doc).toEqual({ storage_path: t.path, file_name: "Contrato real.pdf", text_status: "COMPLETED", page_count: 2 });
  });

  it("mesmo PDF de novo: duplicado detectado e o objeto novo é removido do bucket", async () => {
    const pdf = makeTextPdf(CANONICAL_CONTRACT_PAGES);
    const t = await createUploadIntent(ctx(A), { kind: "CONTRACT_DOCUMENT", fileName: "c.pdf", size: pdf.length, mime: "application/pdf", contractId, documentType: "CONTRACT" });
    await browserUpload(t, pdf);
    expect(await finalizeUpload(ctx(A), t.intent)).toMatchObject({ duplicate: true });
    expect(await exists("contract-documents", t.path)).toBe(false);
  });

  it("conteúdo que não é PDF (extensão falsa) é rejeitado após o upload e removido", async () => {
    const fake = new TextEncoder().encode("<html>não é pdf</html>");
    const t = await createUploadIntent(ctx(A), { kind: "CONTRACT_DOCUMENT", fileName: "x.pdf", size: fake.length, mime: "application/pdf", contractId, documentType: "CONTRACT" });
    expect((await browserUpload(t, fake)).error).toBeNull();
    await expect(finalizeUpload(ctx(A), t.intent)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await exists("contract-documents", t.path)).toBe(false);
  });

  it("bucket recusa tipo não permitido e o token só vale para o path assinado", async () => {
    const pdf = makeTextPdf([["x"]]);
    const t = await createUploadIntent(ctx(A), { kind: "CONTRACT_DOCUMENT", fileName: "y.pdf", size: pdf.length, mime: "application/pdf", contractId, documentType: "CONTRACT" });
    const wrongType = await anon().storage.from(t.bucket).uploadToSignedUrl(t.path, t.token, new Blob([pdf as BlobPart], { type: "text/html" }), { contentType: "text/html" });
    expect(wrongType.error).not.toBeNull();
    const otherPath = await anon().storage.from(t.bucket).uploadToSignedUrl(`${B.orgId}/${crypto.randomUUID()}.pdf`, t.token, new Blob([pdf as BlobPart], { type: "application/pdf" }), { contentType: "application/pdf" });
    expect(otherPath.error).not.toBeNull();
  });

  it("intenção de outra organização/usuário não pode ser finalizada; papel sem permissão não obtém URL", async () => {
    const pdf = makeTextPdf([["outro"]]);
    const t = await createUploadIntent(ctx(A), { kind: "CONTRACT_DOCUMENT", fileName: "z.pdf", size: pdf.length, mime: "application/pdf", contractId, documentType: "CONTRACT" });
    await browserUpload(t, pdf);
    await expect(finalizeUpload(ctx(B), t.intent)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(finalizeUpload(ctx(A, "FINANCE"), t.intent)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createUploadIntent(ctx(A, "EXECUTIVE"), { kind: "IMPORT", importType: "BILLING", fileName: "a.csv", size: 10, mime: "text/csv" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createUploadIntent(ctx(B), { kind: "CONTRACT_DOCUMENT", fileName: "z.pdf", size: 10, mime: "application/pdf", contractId, documentType: "CONTRACT" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("acesso anônimo direto ao bucket privado é negado", async () => {
    const { data } = await anon().storage.from("contract-documents").list(A.orgId);
    expect(data ?? []).toEqual([]);
    const dl = await anon().storage.from("contract-documents").download(`${A.orgId}/qualquer.pdf`);
    expect(dl.error).not.toBeNull();
  });

  it("CSV: upload direto vira import MAPPING_REQUIRED; arquivo idêntico vira DUPLICATE e o objeto extra é removido", async () => {
    const csv = new TextEncoder().encode(`CNPJ;Cliente;Competência;Horas\n${makeCnpj(123)};Cliente;09/2026;10\n`);
    const t1 = await createUploadIntent(ctx(A, "FINANCE"), { kind: "IMPORT", importType: "OPERATIONAL", fileName: "horas.csv", size: csv.length, mime: "application/vnd.ms-excel" });
    expect(t1.contentType).toBe("text/csv");
    await browserUpload(t1, csv);
    const r1 = await finalizeUpload(ctx(A, "FINANCE"), t1.intent);
    expect(r1).toMatchObject({ kind: "IMPORT", result: { status: "MAPPING_REQUIRED", rowCount: 1 } });
    const t2 = await createUploadIntent(ctx(A, "FINANCE"), { kind: "IMPORT", importType: "OPERATIONAL", fileName: "horas (1).csv", size: csv.length, mime: "text/csv" });
    await browserUpload(t2, csv);
    expect(await finalizeUpload(ctx(A, "FINANCE"), t2.intent)).toMatchObject({ result: { status: "DUPLICATE" } });
    expect(await exists("imports", t2.path)).toBe(false);
  });
});
