import { z } from "zod";
import { RULE_TYPES, RULE_UNITS, MONEY_RULE_TYPES, UNIT_RULE_TYPES, type RuleType } from "@/domain/contracts/rules";
import { dec } from "@/domain/money/decimal";
import { makeIsoDate } from "@/domain/competence";

/**
 * Contract Intelligence — abstração de provedor (ADR-022).
 * A IA só PROPÕE regras. Toda saída passa por validação determinística aqui e pela
 * verificação literal do trecho no banco (ADR-013). Nada é ativado automaticamente.
 */

export const EXTRACTION_PROMPT = { name: "contract_rule_extraction_prompt", version: "1.0.0" } as const;

export const ExtractedRuleSchema = z.object({
  rule_type: z.enum(RULE_TYPES),
  /** Valor como texto decimal com ponto ("18000.00", "280", "0.1"); null se não houver valor explícito. */
  value: z.string().nullable(),
  unit: z.enum(RULE_UNITS).nullable(),
  valid_from: z.string().nullable(),
  valid_until: z.string().nullable(),
  source_page: z.number().int(),
  /** Trecho literal copiado do texto da página. */
  source_text: z.string(),
  extraction_confidence: z.number(),
  notes: z.string().nullable(),
});
export const ExtractionOutputSchema = z.object({ rules: z.array(ExtractedRuleSchema) });
export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;
export type ExtractedRule = z.infer<typeof ExtractedRuleSchema>;

export interface DocumentPage {
  pageNumber: number;
  text: string;
}

export interface ExtractionResponse {
  output: ExtractionOutput;
  /** Modelo que efetivamente respondeu (registrado na RuleExtractionRun). */
  servedModel: string;
}

export interface ContractExtractionProvider {
  readonly name: string;
  readonly model: string;
  extract(pages: DocumentPage[]): Promise<ExtractionResponse>;
}

export class ExtractionRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionRefusedError";
  }
}

export const EXTRACTION_SYSTEM_PROMPT = `Você extrai regras comerciais de contratos B2B brasileiros para uma ferramenta de auditoria de faturamento.
Regras obrigatórias:
- Extraia SOMENTE o que estiver escrito explicitamente no texto. Nunca deduza, calcule, complete ou invente valores, índices, datas ou cláusulas.
- Para cada regra, copie em "source_text" um trecho LITERAL e contíguo da página (no máximo 2 frases), exatamente como aparece, e informe "source_page".
- "value" é texto decimal com ponto e sem separador de milhar (ex.: "18000.00", "280", "40"). Para DISCOUNT_PERCENTAGE use fração ("0.1" para 10%). Se o valor não estiver explícito, use null.
- "unit" só para INCLUDED_QUANTITY, EXCESS_UNIT_PRICE e UNIT_PRICE (HOUR, UNIT, USER, TICKET, KM, ITEM, VISIT, OTHER); caso contrário null.
- Datas no formato AAAA-MM-DD somente se escritas no texto; caso contrário null.
- Tipos: FIXED_MONTHLY_FEE (mensalidade fixa), INCLUDED_QUANTITY (quantidade incluída/franquia), EXCESS_UNIT_PRICE (preço por unidade excedente), DISCOUNT_FIXED (desconto em reais), DISCOUNT_PERCENTAGE, PRICE_ADJUSTMENT (reajuste com valor), ADDITIONAL_SERVICE_PRICE, UNIT_PRICE (preço por unidade sem franquia), BILLING_PERIODICITY, PAYMENT_DUE_DAY, ADJUSTMENT_INDEX (ex.: IPCA, IGP-M — só se citado), ADJUSTMENT_PERIODICITY, OTHER.
- "extraction_confidence" entre 0 e 1 reflete sua certeza na interpretação do texto (não no valor financeiro).
- Se não houver regras, retorne {"rules": []}.`;

export function buildExtractionUserPrompt(pages: DocumentPage[]): string {
  const body = pages.map((p) => `<page number="${p.pageNumber}">\n${p.text}\n</page>`).join("\n");
  return `Texto extraído do contrato, por página:\n${body}\n\nExtraia as regras comerciais conforme as instruções.`;
}

export interface ValidatedProposal {
  ruleType: RuleType;
  numericValue: string | null;
  textValue: string | null;
  unit: string | null;
  validFrom: string | null;
  validUntil: string | null;
  sourcePage: number;
  sourceText: string;
  extractionConfidence: string;
  raw: ExtractedRule;
}

export interface DiscardedProposal {
  raw: unknown;
  reason: string;
}

function isoOrNull(s: string | null): string | null | "INVALID" {
  if (s === null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return "INVALID";
  return makeIsoDate(Number(m[1]), Number(m[2]), Number(m[3])) ?? "INVALID";
}

/** Validação determinística da saída da IA. Itens inválidos são descartados com motivo (nunca corrigidos). */
export function validateExtraction(output: unknown, pageCount: number): { proposals: ValidatedProposal[]; discarded: DiscardedProposal[] } {
  const parsed = ExtractionOutputSchema.safeParse(output);
  if (!parsed.success) return { proposals: [], discarded: [{ raw: output, reason: `saída fora do schema: ${parsed.error.message.slice(0, 500)}` }] };
  const proposals: ValidatedProposal[] = [];
  const discarded: DiscardedProposal[] = [];
  for (const r of parsed.data.rules) {
    const reject = (reason: string) => discarded.push({ raw: r, reason });
    if (r.source_page < 1 || r.source_page > pageCount) { reject("página inexistente"); continue; }
    if (r.source_text.trim().length < 3 || r.source_text.length > 4000) { reject("trecho ausente ou longo demais"); continue; }
    if (!(r.extraction_confidence >= 0 && r.extraction_confidence <= 1)) { reject("confiança fora de [0,1]"); continue; }
    const from = isoOrNull(r.valid_from);
    const until = isoOrNull(r.valid_until);
    if (from === "INVALID" || until === "INVALID") { reject("data inválida"); continue; }
    if (from && until && until < from) { reject("vigência invertida"); continue; }

    let numericValue: string | null = null;
    let textValue: string | null = null;
    if (r.value !== null) {
      try {
        const d = dec(r.value);
        if (d.isNegative()) { reject("valor negativo"); continue; }
        if (MONEY_RULE_TYPES.has(r.rule_type) && d.decimalPlaces() > 2) { reject("valor monetário com mais de 2 casas"); continue; }
        if (d.decimalPlaces() > 6) { reject("valor com mais de 6 casas"); continue; }
        if (r.rule_type === "DISCOUNT_PERCENTAGE" && d.greaterThan(1)) { reject("percentual deve ser fração"); continue; }
        numericValue = d.toFixed();
      } catch {
        if (MONEY_RULE_TYPES.has(r.rule_type) || UNIT_RULE_TYPES.has(r.rule_type)) { reject(`valor não numérico: "${r.value}"`); continue; }
        textValue = r.value.slice(0, 2000);
      }
    }
    if ((MONEY_RULE_TYPES.has(r.rule_type) || UNIT_RULE_TYPES.has(r.rule_type) || r.rule_type === "DISCOUNT_PERCENTAGE") && numericValue === null) {
      reject("regra monetária sem valor explícito");
      continue;
    }
    if (UNIT_RULE_TYPES.has(r.rule_type) && !r.unit) { reject("regra de quantidade/preço sem unidade"); continue; }
    if (!UNIT_RULE_TYPES.has(r.rule_type) && r.unit) { reject("unidade em regra que não usa unidade"); continue; }
    if (numericValue === null && textValue === null) textValue = (r.notes ?? r.source_text).slice(0, 2000);
    proposals.push({
      ruleType: r.rule_type,
      numericValue,
      textValue,
      unit: r.unit,
      validFrom: from,
      validUntil: until,
      sourcePage: r.source_page,
      sourceText: r.source_text.trim(),
      extractionConfidence: r.extraction_confidence.toFixed(4),
      raw: r,
    });
  }
  return { proposals, discarded };
}

/**
 * Espelho em TypeScript de app.normalize_excerpt (SQL) — usado só para pré-visualização em scripts.
 * A verificação autoritativa é a do banco (trigger de contract_rules).
 */
export function normalizeExcerpt(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function excerptFoundOnPage(excerpt: string, pageText: string): boolean {
  const needle = normalizeExcerpt(excerpt);
  return needle.length >= 3 && normalizeExcerpt(pageText).includes(needle);
}
