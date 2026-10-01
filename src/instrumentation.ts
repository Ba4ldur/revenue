/** Verificação de ambiente no boot do servidor (Next.js instrumentation). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateEnv } = await import("./lib/env");
  const report = validateEnv(process.env);
  for (const w of report.warnings) console.warn(JSON.stringify({ level: "warn", event: "env.warning", message: w }));
  if (report.errors.length) {
    const msg = `Configuração de ambiente inválida: ${report.errors.join("; ")}`;
    console.error(JSON.stringify({ level: "error", event: "env.invalid", errors: report.errors }));
    if (process.env.NODE_ENV === "production") throw new Error(msg);
  }
}
