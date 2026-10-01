import { describe, expect, it } from "vitest";
import { normalizeName, resolveCustomer, similarity, type ResolutionContext } from "@/domain/entity-resolution/entity-resolution";

const ctx = (extra: Partial<ResolutionContext> = {}): ResolutionContext => ({
  customers: [
    { id: "c-abc", cnpj: "11222333000181", externalId: "ERP-77", legalNameNormalized: normalizeName("Indústria ABC Ltda."), tradeNameNormalized: normalizeName("ABC Indústria") },
    { id: "c-xyz", cnpj: null, externalId: null, legalNameNormalized: normalizeName("XYZ Comércio S/A"), tradeNameNormalized: null },
  ],
  confirmed: new Map(),
  rejected: new Set(),
  ...extra,
});

describe("Entity Resolution 1.0.0", () => {
  it("normaliza nomes (acentos, pontuação, sufixos societários)", () => {
    expect(normalizeName("Indústria ABC Ltda.")).toBe("industria abc");
    expect(normalizeName("XYZ Comércio S/A")).toBe("xyz comercio");
  });

  it("CNPJ exato ⇒ MATCHED automático (confiança 1)", () => {
    expect(resolveCustomer({ cnpj: "11.222.333/0001-81", name: "qualquer" }, ctx())).toMatchObject({ status: "MATCHED", method: "CNPJ_EXACT", customerId: "c-abc", confidence: "1.0000" });
  });

  it("external_id exato ⇒ MATCHED", () => {
    expect(resolveCustomer({ externalId: "ERP-77" }, ctx())).toMatchObject({ status: "MATCHED", method: "EXTERNAL_ID_EXACT" });
  });

  it("razão social exata ⇒ PROPOSED (nunca MATCHED sem humano)", () => {
    expect(resolveCustomer({ name: "INDUSTRIA ABC LTDA" }, ctx())).toMatchObject({ status: "PROPOSED", method: "LEGAL_NAME_EXACT", customerId: "c-abc" });
  });

  it("TESTE 8 — fuzzy de baixa confiança ⇒ PROPOSED, não MATCHED", () => {
    const r = resolveCustomer({ name: "Industria ABCD" }, ctx());
    expect(r).toMatchObject({ status: "PROPOSED", method: "FUZZY", customerId: "c-abc" });
    expect(Number(r!.confidence)).toBeLessThan(0.9);
  });

  it("sem semelhança suficiente ⇒ UNMATCHED", () => {
    expect(resolveCustomer({ name: "Padaria do João" }, ctx())).toMatchObject({ status: "UNMATCHED", customerId: null });
  });

  it("vínculo confirmado anteriormente é reutilizado", () => {
    const confirmed = new Map([["name:industria abcd", { matchId: "m1", customerId: "c-abc", confidence: "0.8000" }]]);
    expect(resolveCustomer({ name: "Industria ABCD" }, ctx({ confirmed }))).toMatchObject({ status: "MATCHED", method: "PREVIOUS_MATCH", previousMatchId: "m1" });
  });

  it("candidato rejeitado não é proposto de novo", () => {
    const rejected = new Set(["name:industria abcd|c-abc"]);
    expect(resolveCustomer({ name: "Industria ABCD" }, ctx({ rejected }))).toMatchObject({ status: "UNMATCHED" });
  });

  it("similaridade é determinística e simétrica", () => {
    expect(similarity("industria abc", "industria abcd")).toBe(similarity("industria abcd", "industria abc"));
  });
});
