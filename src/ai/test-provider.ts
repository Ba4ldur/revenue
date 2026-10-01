import type { ContractExtractionProvider, DocumentPage, ExtractedRule, ExtractionResponse } from "./contract-extraction";

/**
 * DUBLÊ DE TESTE — não é IA. Reconhece por expressão regular apenas as três cláusulas do
 * cenário canônico, para permitir E2E sem credenciais externas. Bloqueado em produção
 * (ver ai/factory.ts). Passa pela mesma validação e verificação de trecho que o provedor real.
 */
export class DeterministicTestExtractionProvider implements ContractExtractionProvider {
  readonly name = "deterministic-test";
  readonly model = "regex-fixture-1";

  async extract(pages: DocumentPage[]): Promise<ExtractionResponse> {
    const rules: ExtractedRule[] = [];
    const brl = (s: string) => s.replace(/\./g, "").replace(",", ".");
    for (const p of pages) {
      const text = p.text.replace(/\s+/g, " ");
      const fee = /mensalidade fixa de R\$ ?([\d.]+,\d{2})/i.exec(text);
      if (fee) rules.push(rule("FIXED_MONTHLY_FEE", brl(fee[1]!), null, p.pageNumber, fee[0]));
      const inc = /incluídas (\d+) horas mensais/i.exec(text);
      if (inc) rules.push(rule("INCLUDED_QUANTITY", inc[1]!, "HOUR", p.pageNumber, inc[0]));
      const exc = /hora adicional será faturada a R\$ ?([\d.]+,\d{2})/i.exec(text);
      if (exc) rules.push(rule("EXCESS_UNIT_PRICE", brl(exc[1]!), "HOUR", p.pageNumber, exc[0]));
    }
    return { output: { rules }, servedModel: this.model };
  }
}

function rule(rule_type: ExtractedRule["rule_type"], value: string, unit: ExtractedRule["unit"], page: number, excerpt: string): ExtractedRule {
  return { rule_type, value, unit, valid_from: null, valid_until: null, source_page: page, source_text: excerpt, extraction_confidence: 0.9, notes: null };
}
