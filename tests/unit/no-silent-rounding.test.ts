import { describe, expect, it } from "vitest";
import { createManualRule } from "@/application/rules";
import { setMaterialityPolicy } from "@/application/organizations";
import type { OrgContext } from "@/application/context";

/** Entradas com precisão acima da suportada são rejeitadas, nunca arredondadas em silêncio. */
const ctx: OrgContext = { userId: "00000000-0000-4000-8000-000000000001", orgId: "00000000-0000-4000-8000-000000000002", role: "ADMIN", orgName: "x" };
const base = { contractVersionId: "00000000-0000-4000-8000-000000000003", sourceDocumentId: "00000000-0000-4000-8000-000000000004", validFrom: "2026-01-01", sourceText: "trecho do contrato" };

describe("sem arredondamento silencioso de entradas", () => {
  it("preço unitário com 7 casas é rejeitado", async () => {
    await expect(createManualRule(ctx, { ...base, ruleType: "EXCESS_UNIT_PRICE", unit: "HOUR", value: "280,1234567" })).rejects.toMatchObject({ code: "VALIDATION" });
  });
  it("mensalidade com 3 casas é rejeitada", async () => {
    await expect(createManualRule(ctx, { ...base, ruleType: "FIXED_MONTHLY_FEE", value: "18.000,005" })).rejects.toMatchObject({ code: "VALIDATION" });
  });
  it("limites de materialidade com precisão excessiva são rejeitados", async () => {
    await expect(setMaterialityPolicy(ctx, { mode: "ABSOLUTE", absoluteThreshold: "500,555", percentagePoints: null, combinationOperator: null })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(setMaterialityPolicy(ctx, { mode: "PERCENTAGE", absoluteThreshold: null, percentagePoints: "1,1234567", combinationOperator: null })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
