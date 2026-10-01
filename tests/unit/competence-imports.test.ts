import { describe, expect, it } from "vitest";
import { addMonths, asCompetence, formatCompetence, monthCoverage, parseCompetence, parseIsoDate } from "@/domain/competence";
import { isValidCnpj, normalizeCnpj } from "@/domain/cnpj";
import { assignDedupKeys, normalizeRow, parseDecimalCell, type ImportOptions } from "@/domain/imports/normalization";

describe("TESTE 16 — competência", () => {
  it.each([
    ["09/2026", "2026-09-01"],
    ["9/2026", "2026-09-01"],
    ["2026-09", "2026-09-01"],
    ["2026-09-01", "2026-09-01"],
    ["set/26", "2026-09-01"],
    ["Set/2026", "2026-09-01"],
    ["setembro/2026", "2026-09-01"],
    ["Setembro de 2026", "2026-09-01"],
    ["março/2026", "2026-03-01"],
    ["15/09/2026", "2026-09-01"],
  ])("%s ⇒ %s", (raw, expected) => {
    expect(parseCompetence(raw)).toEqual({ ok: true, value: expected });
  });

  it("rejeita ambíguos/inválidos", () => {
    for (const raw of ["13/2026", "2026-13", "foo/2026", "", "09-26-2026", "31/02/2026"]) {
      expect(parseCompetence(raw).ok).toBe(false);
    }
  });

  it("datas são DD/MM/AAAA (nunca MM/DD)", () => {
    expect(parseIsoDate("03/09/2026")).toEqual({ ok: true, value: "2026-09-03" });
    expect(parseIsoDate("09/13/2026").ok).toBe(false);
    expect(parseIsoDate(new Date(Date.UTC(2026, 8, 30)))).toEqual({ ok: true, value: "2026-09-30" });
  });

  it("utilitários", () => {
    expect(addMonths(asCompetence("2026-01-01"), -1)).toBe("2025-12-01");
    expect(formatCompetence("2026-09-01")).toBe("09/2026");
    expect(monthCoverage(asCompetence("2026-06-01"), "2026-01-01", "2026-06-30")).toBe("FULL");
    expect(monthCoverage(asCompetence("2026-07-01"), "2026-01-01", "2026-06-30")).toBe("NONE");
    expect(monthCoverage(asCompetence("2026-06-01"), "2026-06-10", null)).toBe("PARTIAL");
  });
});

describe("Números (sem heurística silenciosa)", () => {
  it("formato BR", () => {
    expect(parseDecimalCell("1.234,56", "BR")).toMatchObject({ ok: true });
    expect((parseDecimalCell("R$ 18.000,00", "BR") as { value: { toFixed(): string } }).value.toFixed()).toBe("18000");
    expect(parseDecimalCell("1.5", "BR").ok).toBe(false); // ambíguo no formato BR
    expect(parseDecimalCell("1,234.56", "BR").ok).toBe(false);
  });
  it("formato US e células numéricas do XLSX", () => {
    expect((parseDecimalCell("1,234.56", "US") as { value: { toFixed(): string } }).value.toFixed()).toBe("1234.56");
    expect((parseDecimalCell(57.25, "BR") as { value: { toFixed(): string } }).value.toFixed()).toBe("57.25");
    expect(parseDecimalCell("1.234,56", "US").ok).toBe(false);
  });
});

describe("CNPJ", () => {
  it("normaliza e valida (numérico e alfanumérico)", () => {
    expect(normalizeCnpj("11.222.333/0001-81")).toBe("11222333000181");
    expect(isValidCnpj("11222333000181")).toBe(true);
    expect(isValidCnpj("11222333000180")).toBe(false);
    expect(isValidCnpj("12ABC34501DE35")).toBe(true);
    expect(isValidCnpj("00000000000000")).toBe(false);
  });
});

describe("Normalização de linhas", () => {
  const opOptions: ImportOptions = { numberFormat: "BR", competence: { mode: "COLUMN" }, defaultUnit: "HOUR", defaultEventType: "SUPORTE" };
  const opMapping = { cnpj: "CNPJ", customer_name: "Cliente", competence: "Competência", quantity: "Horas" };

  it("linha operacional válida", () => {
    const r = normalizeRow("OPERATIONAL", { CNPJ: "11.222.333/0001-81", Cliente: "Indústria ABC", "Competência": "09/2026", Horas: "57" }, opMapping, opOptions);
    expect(r).toEqual({
      ok: true,
      data: expect.objectContaining({ competence: "2026-09-01", quantity: "57.000000", unit: "HOUR", customer: { cnpj: "11222333000181", externalId: null, name: "Indústria ABC" } }),
    });
  });

  it("CNPJ sem zeros à esquerda (planilha) é recuperado", () => {
    const r = normalizeRow("OPERATIONAL", { CNPJ: 6990590000123, Cliente: "X", "Competência": "09/2026", Horas: "1" }, opMapping, opOptions);
    expect(r.ok && r.data.customer.cnpj).toBe("06990590000123");
  });

  it("erros por campo são reportados, nada é inventado", () => {
    const r = normalizeRow("OPERATIONAL", { CNPJ: "123", Cliente: "", "Competência": "13/2026", Horas: "-3" }, opMapping, opOptions);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.field).sort()).toEqual(["cnpj", "competence", "quantity"]);
  });

  it("faturamento: valor negativo e data ausente rejeitados; competência derivada só se escolhida", () => {
    const mapping = { customer_name: "Cliente", amount: "Valor", date: "Emissão", document_number: "NF" };
    const neg = normalizeRow("BILLING", { Cliente: "ABC", Valor: "-10,00", "Emissão": "05/10/2026", NF: "1" }, mapping, { numberFormat: "BR", competence: { mode: "FROM_DATE", offsetMonths: 1 } });
    expect(neg.ok).toBe(false);
    const ok = normalizeRow("BILLING", { Cliente: "ABC", Valor: "18.000,00", "Emissão": "05/10/2026", NF: "1234" }, mapping, { numberFormat: "BR", competence: { mode: "FROM_DATE", offsetMonths: 1 } });
    expect(ok.ok && ok.data).toMatchObject({ competence: "2026-09-01", billingDate: "2026-10-05", amount: "18000.00", documentNumber: "1234" });
  });

  it("chaves de deduplicação: linhas idênticas no arquivo são distintas; reimport gera as mesmas chaves", () => {
    const row = normalizeRow("OPERATIONAL", { CNPJ: "11222333000181", Cliente: "A", "Competência": "09/2026", Horas: "2" }, opMapping, opOptions);
    if (!row.ok) throw new Error("x");
    const keys1 = assignDedupKeys([row.data, row.data]);
    const keys2 = assignDedupKeys([row.data, row.data]);
    expect(keys1[0]).not.toBe(keys1[1]);
    expect(keys1).toEqual(keys2);
    expect(assignDedupKeys([{ ...row.data, externalId: "OS-1" }])).toEqual(["ext:OS-1"]);
  });
});
