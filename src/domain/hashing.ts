import { createHash } from "node:crypto";

/**
 * JSON canônico: chaves ordenadas, sem espaços. Arrays mantêm a ordem recebida — quem
 * monta o snapshot é responsável por ordená-los de forma determinística (ex.: por id).
 * `number` é proibido (valores trafegam como string) para que o hash não dependa de float.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("canonicalJson: número não inteiro; use string decimal");
    return value;
  }
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = normalize(v);
    }
    return out;
  }
  throw new TypeError(`canonicalJson: tipo não suportado ${typeof value}`);
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
