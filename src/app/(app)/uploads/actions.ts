"use server";

import { revalidatePath } from "next/cache";
import { createUploadIntent, finalizeUpload } from "@/application/uploads";
import { requireOrg } from "@/lib/session";
import { runAction, type ActionState } from "@/lib/actions";

/** Emite URL assinada de upload direto ao Storage (o arquivo não trafega pela função do servidor). */
export async function createUploadIntentAction(input: Record<string, unknown>): Promise<ActionState> {
  const ctx = await requireOrg();
  return runAction(async () => {
    const t = await createUploadIntent(ctx, input);
    return { ok: true, data: { ...t } };
  });
}

/** Revalida o conteúdo enviado e registra documento ou import. */
export async function finalizeUploadAction(intent: string): Promise<ActionState> {
  const ctx = await requireOrg();
  return runAction(async () => {
    const r = await finalizeUpload(ctx, intent);
    if (r.kind === "CONTRACT_DOCUMENT") {
      revalidatePath("/contracts");
      return { ok: true, message: r.duplicate ? "Este arquivo já estava anexado ao contrato (mesmo hash)." : "Documento armazenado com texto extraído por página.", data: { documentId: r.documentId } };
    }
    revalidatePath("/imports");
    return { ok: true, data: { importId: r.result.importId, status: r.result.status } };
  });
}
