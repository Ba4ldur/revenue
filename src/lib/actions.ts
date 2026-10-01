import "server-only";
import { AppError } from "@/application/errors";
import { logger } from "@/lib/logger";

export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  data?: Record<string, unknown>;
}

/** Converte erros em mensagem segura para o formulário; erros inesperados não vazam detalhes. */
export async function runAction(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
    logger.error("action.unexpected", { error: (e as Error)?.message?.slice(0, 300) });
    return { error: "Erro inesperado; a operação não foi concluída." };
  }
}

export function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}
