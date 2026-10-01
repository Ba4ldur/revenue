import { describe, expect, it } from "vitest";
import { AnthropicExtractionProvider } from "@/ai/anthropic-provider";
import { ExtractionRefusedError, validateExtraction } from "@/ai/contract-extraction";

/** Testa o adaptador real (SDK oficial) com fetch simulado: formato da requisição e tratamento da resposta. */
function fakeFetch(response: Record<string, unknown>, capture: { body?: Record<string, unknown>; headers?: Headers }) {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    capture.body = JSON.parse(String(init?.body));
    capture.headers = new Headers(init?.headers);
    return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json", "request-id": "req_test" } });
  }) as typeof fetch;
}

const message = (content: unknown[], stop_reason = "end_turn", extra: Record<string, unknown> = {}) => ({
  id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason, stop_sequence: null,
  usage: { input_tokens: 100, output_tokens: 50 }, ...extra,
});

const RULES = { rules: [{ rule_type: "FIXED_MONTHLY_FEE", value: "18000.00", unit: null, valid_from: null, valid_until: null, source_page: 1,
  source_text: "mensalidade fixa de R$ 18.000,00", extraction_confidence: 0.95, notes: null }] };

describe("AnthropicExtractionProvider", () => {
  it("envia saída estruturada, modelo e esforço; a chave vai só no header; devolve a saída validada", async () => {
    const cap: { body?: Record<string, unknown>; headers?: Headers } = {};
    const p = new AnthropicExtractionProvider("claude-opus-5-5", "sk-test-key", { fetch: fakeFetch(message([{ type: "text", text: JSON.stringify(RULES) }]), cap), maxRetries: 0 });
    const r = await p.extract([{ pageNumber: 1, text: "O CONTRATANTE pagará mensalidade fixa de R$ 18.000,00." }]);
    expect(r.servedModel).toBe("claude-opus-5-5");
    expect(validateExtraction(r.output, 1).proposals).toHaveLength(1);
    expect(cap.body).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "high", format: { type: "json_schema" } } });
    expect(JSON.stringify(cap.body)).toContain('<page number=\\"1\\">');
    expect(JSON.stringify(cap.body)).not.toContain("sk-test-key");
    expect(cap.headers?.get("x-api-key")).toBe("sk-test-key");
  });

  it("recusa do modelo vira ExtractionRefusedError (nenhuma regra criada)", async () => {
    const p = new AnthropicExtractionProvider("claude-opus-5-5", "k", { fetch: fakeFetch(message([], "refusal", { stop_details: { type: "refusal", category: "cyber", explanation: null } }), {}), maxRetries: 0 });
    await expect(p.extract([{ pageNumber: 1, text: "x" }])).rejects.toBeInstanceOf(ExtractionRefusedError);
  });

  it("resposta truncada (max_tokens) é erro, nunca resultado parcial", async () => {
    const p = new AnthropicExtractionProvider("claude-opus-5-5", "k", { fetch: fakeFetch(message([{ type: "text", text: '{"rules": [' }], "max_tokens"), {}), maxRetries: 0 });
    await expect(p.extract([{ pageNumber: 1, text: "x" }])).rejects.toThrow(/truncada|JSON|parse/i);
  });
});
