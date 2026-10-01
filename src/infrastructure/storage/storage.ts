import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Storage privado (ADR-023). Upload e signed URL somente pelo servidor com service role,
 * DEPOIS da checagem de autorização. Não há políticas de acesso direto para usuários.
 */
export type Bucket = "contract-documents" | "imports";

let admin: SupabaseClient | null = null;
function client(): SupabaseClient {
  if (admin) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Storage não configurado (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

export async function putObject(bucket: Bucket, path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { error } = await client().storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
  if (error && !/already exists|Duplicate/i.test(error.message)) throw new Error(`falha no upload: ${error.message}`);
}

export async function getObject(bucket: Bucket, path: string): Promise<Uint8Array> {
  const { data, error } = await client().storage.from(bucket).download(path);
  if (error || !data) throw new Error(`falha no download: ${error?.message ?? "vazio"}`);
  return new Uint8Array(await data.arrayBuffer());
}

export async function signedUrl(bucket: Bucket, path: string, seconds = 60, downloadName?: string): Promise<string> {
  const { data, error } = await client().storage.from(bucket).createSignedUrl(path, seconds, downloadName ? { download: downloadName } : undefined);
  if (error || !data) throw new Error(`falha ao assinar URL: ${error?.message ?? ""}`);
  return data.signedUrl;
}

/** URL assinada para upload direto do navegador ao bucket privado (sem passar pela função serverless). */
export async function createSignedUpload(bucket: Bucket, path: string): Promise<{ signedUrl: string; token: string; path: string }> {
  const { data, error } = await client().storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`falha ao assinar upload: ${error?.message ?? ""}`);
  return { signedUrl: data.signedUrl, token: data.token, path: data.path };
}

/** Remoção de objeto não registrado (upload rejeitado, duplicado ou falha de registro). Melhor esforço. */
export async function removeObject(bucket: Bucket, path: string): Promise<void> {
  const { error } = await client().storage.from(bucket).remove([path]);
  if (error) throw new Error(`falha ao remover objeto: ${error.message}`);
}
