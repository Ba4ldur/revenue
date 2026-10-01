import "server-only";
import type { ContractExtractionProvider } from "./contract-extraction";
import { AnthropicExtractionProvider } from "./anthropic-provider";
import { DeterministicTestExtractionProvider } from "./test-provider";

/** Sem AI_PROVIDER configurado a extração fica indisponível (sem fallback silencioso — ADR-022). */
export function getExtractionProvider(): ContractExtractionProvider | null {
  const provider = process.env.AI_PROVIDER?.trim();
  if (!provider) return null;
  if (provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("AI_PROVIDER=anthropic exige ANTHROPIC_API_KEY");
    return new AnthropicExtractionProvider(process.env.AI_EXTRACTION_MODEL?.trim() || "claude-opus-5-5", key);
  }
  if (provider === "deterministic-test") {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_TEST_PROVIDER !== "1") {
      throw new Error("provedor de teste não pode ser usado em produção");
    }
    return new DeterministicTestExtractionProvider();
  }
  throw new Error(`AI_PROVIDER desconhecido: ${provider}`);
}
