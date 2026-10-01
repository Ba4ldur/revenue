import { readFileSync, existsSync } from "node:fs";
// Carrega .env.local (Supabase local) para testes de integração; nunca sobrescreve env já definido.
const path = new URL("../.env.local", import.meta.url);
if (existsSync(path)) {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2];
  }
}
