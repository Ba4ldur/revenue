import { isValidCnpj, normalizeCnpj } from "../cnpj";

/**
 * ENTITY RESOLUTION ENGINE — determinístico.
 * Prioridade: CNPJ exato → external_id → vínculo confirmado → razão social → nome fantasia → fuzzy.
 * Somente CNPJ e external_id exatos geram MATCHED automático; o resto é PROPOSED (exige humano).
 */
export const ENTITY_RESOLUTION_ENGINE = { name: "entity_resolution_engine", version: "1.0.0" } as const;

export const FUZZY_PROPOSAL_THRESHOLD = 0.6;

const CORPORATE_SUFFIXES = /\b(ltda|ltd|s\/?a|sa|me|epp|eireli|mei|ss|cia|companhia|limitada)\b/g;

export function normalizeName(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " e ")
    .replace(/[^a-z0-9/ ]+/g, " ")
    .replace(CORPORATE_SUFFIXES, " ")
    .replace(/\//g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trigrams(s: string): Map<string, number> {
  const padded = `  ${s} `;
  const m = new Map<string, number>();
  for (let i = 0; i < padded.length - 2; i++) {
    const g = padded.slice(i, i + 3);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Coeficiente de Sørensen–Dice sobre trigramas (0..1). */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let inter = 0;
  let total = 0;
  for (const [g, n] of ta) {
    inter += Math.min(n, tb.get(g) ?? 0);
    total += n;
  }
  for (const n of tb.values()) total += n;
  return (2 * inter) / total;
}

export interface CustomerCandidate {
  id: string;
  cnpj: string | null;
  externalId: string | null;
  legalNameNormalized: string;
  tradeNameNormalized: string | null;
}

export interface SourceIdentity {
  cnpj?: string | null;
  externalId?: string | null;
  name?: string | null;
}

export type MatchMethod =
  | "CNPJ_EXACT"
  | "EXTERNAL_ID_EXACT"
  | "PREVIOUS_MATCH"
  | "LEGAL_NAME_EXACT"
  | "TRADE_NAME_EXACT"
  | "FUZZY"
  | "NONE";

export interface ResolutionResult {
  sourceKey: string;
  sourceLabel: string;
  status: "MATCHED" | "PROPOSED" | "UNMATCHED";
  method: MatchMethod;
  customerId: string | null;
  confidence: string | null;
  previousMatchId?: string;
}

export interface ResolutionContext {
  customers: CustomerCandidate[];
  /** Vínculos MATCHED existentes por source_key. */
  confirmed: Map<string, { matchId: string; customerId: string; confidence: string | null }>;
  /** Pares source_key|customer_id já rejeitados por humano. */
  rejected: Set<string>;
}

export function sourceKeyOf(identity: SourceIdentity): { key: string; label: string } | null {
  const cnpj = normalizeCnpj(identity.cnpj ?? null);
  if (cnpj && isValidCnpj(cnpj)) return { key: `cnpj:${cnpj}`, label: identity.name?.trim() || cnpj };
  const ext = identity.externalId?.trim();
  if (ext) return { key: `ext:${ext}`, label: identity.name?.trim() || ext };
  const name = normalizeName(identity.name);
  if (name) return { key: `name:${name}`, label: identity.name!.trim() };
  return null;
}

function fixed4(n: number): string {
  // Confiança é metadado (não é dinheiro): arredondamento para 4 casas em string.
  return (Math.round(n * 10000) / 10000).toFixed(4);
}

export function resolveCustomer(identity: SourceIdentity, ctx: ResolutionContext): ResolutionResult | null {
  const src = sourceKeyOf(identity);
  if (!src) return null;
  const notRejected = (customerId: string) => !ctx.rejected.has(`${src.key}|${customerId}`);
  const out = (r: Omit<ResolutionResult, "sourceKey" | "sourceLabel">): ResolutionResult => ({ sourceKey: src.key, sourceLabel: src.label, ...r });

  const cnpj = normalizeCnpj(identity.cnpj ?? null);
  if (cnpj && isValidCnpj(cnpj)) {
    const c = ctx.customers.find((x) => x.cnpj === cnpj);
    if (c) return out({ status: "MATCHED", method: "CNPJ_EXACT", customerId: c.id, confidence: "1.0000" });
  }
  const ext = identity.externalId?.trim();
  if (ext) {
    const c = ctx.customers.find((x) => x.externalId === ext);
    if (c) return out({ status: "MATCHED", method: "EXTERNAL_ID_EXACT", customerId: c.id, confidence: "1.0000" });
  }
  const prev = ctx.confirmed.get(src.key);
  if (prev && ctx.customers.some((c) => c.id === prev.customerId)) {
    return out({ status: "MATCHED", method: "PREVIOUS_MATCH", customerId: prev.customerId, confidence: prev.confidence, previousMatchId: prev.matchId });
  }

  const name = normalizeName(identity.name);
  if (!name) return out({ status: "UNMATCHED", method: "NONE", customerId: null, confidence: null });

  const legal = ctx.customers.filter((c) => c.legalNameNormalized === name && notRejected(c.id));
  if (legal.length === 1) return out({ status: "PROPOSED", method: "LEGAL_NAME_EXACT", customerId: legal[0]!.id, confidence: "0.9500" });
  const trade = ctx.customers.filter((c) => c.tradeNameNormalized === name && notRejected(c.id));
  if (trade.length === 1 && legal.length === 0) {
    return out({ status: "PROPOSED", method: "TRADE_NAME_EXACT", customerId: trade[0]!.id, confidence: "0.9000" });
  }

  let best: { id: string; score: number } | null = null;
  for (const c of [...ctx.customers].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!notRejected(c.id)) continue;
    const score = Math.max(similarity(name, c.legalNameNormalized), similarity(name, c.tradeNameNormalized ?? ""));
    if (!best || score > best.score) best = { id: c.id, score };
  }
  if (best && best.score >= FUZZY_PROPOSAL_THRESHOLD) {
    // Fuzzy nunca passa de 0.89: não pode ser confundido com match exato.
    return out({ status: "PROPOSED", method: "FUZZY", customerId: best.id, confidence: fixed4(Math.min(0.89, best.score * 0.9)) });
  }
  return out({ status: "UNMATCHED", method: "NONE", customerId: null, confidence: null });
}
