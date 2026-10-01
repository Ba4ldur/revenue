import { dbErrorCode } from "@/infrastructure/db/client";
import { logger } from "@/lib/logger";

/** Erro de aplicação com código estável e mensagem segura para o usuário. */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const forbidden = (msg = "Você não tem permissão para esta ação") => new AppError("FORBIDDEN", msg, 403);
export const notFound = (what = "Registro") => new AppError("NOT_FOUND", `${what} não encontrado`, 404);
export const invalid = (msg: string, details?: Record<string, unknown>) => new AppError("VALIDATION", msg, 422, details);

const DB_MESSAGES: Record<string, string> = {
  FORBIDDEN: "Você não tem permissão para esta ação",
  UNIQUE_VIOLATION: "Já existe um registro com esses dados",
  EXCLUSION_VIOLATION: "Já existe um registro vigente que se sobrepõe a este período",
  FK_VIOLATION: "Referência inválida",
  CHECK_VIOLATION: "Dados inválidos",
};

/** Converte erros do banco (triggers/constraints) em AppError sem vazar detalhes internos. */
export function fromDbError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const code = dbErrorCode(err);
  const message = (err as Error)?.message ?? "";
  if (code && /^[A-Z_]+$/.test(code) && message.startsWith(code + ":")) {
    return new AppError(code, message.slice(code.length + 1).trim(), code === "FORBIDDEN" ? 403 : 409);
  }
  if (/row-level security/.test(message)) return forbidden();
  if (code && DB_MESSAGES[code]) return new AppError(code, DB_MESSAGES[code]!, code === "FORBIDDEN" ? 403 : 409);
  logger.error("internal_error", { code: (err as { code?: string })?.code ?? null, message: message.slice(0, 300) });
  return new AppError("INTERNAL", "Erro interno; a operação não foi concluída", 500);
}
