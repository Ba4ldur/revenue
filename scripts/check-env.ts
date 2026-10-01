/** Verifica a configuração de ambiente sem imprimir valores. Uso: npm run check:env */
import { readFileSync, existsSync } from "node:fs";
import { validateEnv } from "../src/lib/env";

const file = process.argv[2] ?? ".env.local";
const env: Record<string, string | undefined> = { ...process.env };
if (existsSync(file)) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && env[m[1]!] === undefined) env[m[1]!] = m[2];
  }
}
const r = validateEnv(env);
console.log(`Arquivo: ${existsSync(file) ? file : "(apenas variáveis do processo)"} · modo: ${r.production ? "produção" : r.local ? "stack local" : "desenvolvimento"}`);
for (const w of r.warnings) console.log(`AVISO  ${w}`);
for (const e of r.errors) console.log(`ERRO   ${e}`);
console.log(r.errors.length ? "Configuração INVÁLIDA" : "Configuração válida");
process.exit(r.errors.length ? 1 : 0);
