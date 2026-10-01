import "server-only";
import type { ContractExtractionProvider } from "./contract-extraction";
import { AnthropicExtractionProvider } from "./anthropic-provider";
import { DeterministicTestExtractionProvider } from "./test-provider";
import { testProviderAllowed } from "@/lib/env";

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
    if (!testProviderAllowed(process.env)) {
      throw new Error("provedor de teste só é permitido com Supabase e Postgres locais");
    }
    return new DeterministicTestExtractionProvider();
  }
  throw new Error(`AI_PROVIDER desconhecido: ${provider}`);
}
