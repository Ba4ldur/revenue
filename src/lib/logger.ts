/**
 * Log técnico estruturado (OBSERVABILITY). Registra ids, versões, durações e contagens —
 * nunca conteúdo de contrato, linhas de import ou valores pessoais.
 */
type Level = "info" | "warn" | "error";

function emit(level: Level, event: string, data: Record<string, unknown>): void {
  if (process.env.NODE_ENV === "test" && level === "info") return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...data });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (event: string, data: Record<string, unknown> = {}) => emit("info", event, data),
  warn: (event: string, data: Record<string, unknown> = {}) => emit("warn", event, data),
  error: (event: string, data: Record<string, unknown> = {}) => emit("error", event, data),
};
