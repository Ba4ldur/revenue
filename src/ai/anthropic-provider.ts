import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  EXTRACTION_SYSTEM_PROMPT,
  ExtractionOutputSchema,
  ExtractionRefusedError,
  buildExtractionUserPrompt,
  type ContractExtractionProvider,
  type DocumentPage,
  type ExtractionResponse,
} from "./contract-extraction";

/**
 * Provedor Anthropic. Envia apenas o texto já extraído das páginas (o mesmo texto contra o
 * qual o banco verifica o trecho citado). Sem fallback automático de modelo: em recusa a
 * extração falha e o usuário pode cadastrar a regra manualmente com o trecho do contrato.
 */
export class AnthropicExtractionProvider implements ContractExtractionProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(readonly model: string, apiKey: string) {
    this.client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });
  }

  async extract(pages: DocumentPage[]): Promise<ExtractionResponse> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 16000,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildExtractionUserPrompt(pages) }],
      output_config: { effort: "high", format: zodOutputFormat(ExtractionOutputSchema) },
    });
    if (response.stop_reason === "refusal") {
      throw new ExtractionRefusedError(`modelo recusou a extração (${response.stop_details?.category ?? "sem categoria"})`);
    }
    if (response.stop_reason === "max_tokens") {
      throw new Error("resposta truncada (max_tokens); documento grande demais para uma extração");
    }
    if (!response.parsed_output) throw new Error("saída estruturada ausente");
    return { output: response.parsed_output, servedModel: response.model };
  }
}
