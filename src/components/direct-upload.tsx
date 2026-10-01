"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import type { ActionState } from "./forms";

type Phase = "idle" | "preparing" | "uploading" | "validating";
const LABEL: Record<Phase, string> = { idle: "", preparing: "Preparando…", uploading: "Enviando arquivo…", validating: "Validando e registrando…" };

/**
 * Upload direto ao Storage: 1) pede intenção assinada ao servidor; 2) envia o arquivo ao bucket
 * privado pela URL assinada; 3) servidor revalida conteúdo e registra. Só a chave anônima pública é usada.
 */
export function DirectUploadForm({
  kind, extra, submitLabel, accept, children, createIntent, finalize, redirectToImport = false,
}: {
  kind: "CONTRACT_DOCUMENT" | "IMPORT";
  extra?: Record<string, string>;
  submitLabel: string;
  accept: string;
  children?: React.ReactNode;
  createIntent: (input: Record<string, unknown>) => Promise<ActionState>;
  finalize: (intent: string) => Promise<ActionState>;
  redirectToImport?: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Selecione um arquivo");
    try {
      setPhase("preparing");
      const fields = Object.fromEntries([...fd.entries()].filter(([k, v]) => k !== "file" && typeof v === "string" && v !== ""));
      const intent = await createIntent({ ...extra, ...fields, kind, fileName: file.name, size: file.size, mime: file.type });
      if (intent.error || !intent.data) throw new Error(intent.error ?? "Falha ao preparar o envio");
      const t = intent.data as { intent: string; bucket: string; path: string; token: string; contentType: string };

      setPhase("uploading");
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !anon) throw new Error("Armazenamento não configurado");
      const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
      // O supabase-js usa o tipo do próprio File (ignora contentType); o navegador pode declarar outro MIME
      // (ex.: CSV como application/vnd.ms-excel no Windows). Reembala com o tipo canônico aceito pelo bucket.
      const body = new File([file], file.name, { type: t.contentType });
      const up = await sb.storage.from(t.bucket).uploadToSignedUrl(t.path, t.token, body, { contentType: t.contentType });
      if (up.error) throw new Error("O armazenamento recusou o arquivo (tamanho ou tipo não permitido)");

      setPhase("validating");
      const res = await finalize(t.intent);
      if (res.error) throw new Error(res.error);
      if (redirectToImport && res.data?.importId) {
        router.push(`/imports/${String(res.data.importId)}${res.data.status === "DUPLICATE" ? "?dup=1" : ""}`);
        return;
      }
      form.reset();
      setMessage(res.message ?? "Arquivo registrado.");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPhase("idle");
    }
  }

  const busy = phase !== "idle";
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-ink-2">Arquivo</span>
          <input name="file" type="file" accept={accept} required disabled={busy} className="text-sm" />
        </label>
        {children}
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} aria-busy={busy}
          className="inline-flex items-center rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-2 disabled:cursor-wait disabled:opacity-60">
          {busy ? LABEL[phase] : submitLabel}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {message && <p role="status" className="text-sm text-good">{message}</p>}
    </form>
  );
}
