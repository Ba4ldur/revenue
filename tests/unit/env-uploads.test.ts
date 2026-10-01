import { beforeAll, describe, expect, it } from "vitest";
import { isLocalStack, testProviderAllowed, validateEnv } from "@/lib/env";
import { decodeIntent, encodeIntent } from "@/application/uploads";
import { validateDeclared } from "@/application/files";

const local = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_x", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_y",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres", UPLOAD_SIGNING_SECRET: "x".repeat(32),
};
const prod = {
  ...local, NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", NEXT_PUBLIC_SITE_URL: "https://app.example.com",
  DATABASE_URL: "postgresql://u:p@aws-0-sa-east-1.pooler.supabase.com:6543/postgres", AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-ant-x",
};

describe("validação de ambiente", () => {
  it("produção válida", () => {
    expect(validateEnv(prod)).toMatchObject({ errors: [], production: true, local: false });
  });

  it("provider de teste é recusado fora da stack local, mesmo com ALLOW_TEST_PROVIDER", () => {
    const r = validateEnv({ ...prod, AI_PROVIDER: "deterministic-test", ALLOW_TEST_PROVIDER: "1" });
    expect(r.errors.join(" ")).toMatch(/deterministic-test só é permitido/);
    expect(r.errors.join(" ")).toMatch(/ALLOW_TEST_PROVIDER não pode/);
    expect(testProviderAllowed({ ...prod, ALLOW_TEST_PROVIDER: "1" })).toBe(false);
    expect(testProviderAllowed({ ...local, NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" })).toBe(false);
    expect(testProviderAllowed({ ...local, VERCEL: "1" })).toBe(false);
    expect(testProviderAllowed({ ...local, NODE_ENV: "production" })).toBe(false);
    expect(testProviderAllowed({ ...local, NODE_ENV: "production", ALLOW_TEST_PROVIDER: "1" })).toBe(true);
    expect(testProviderAllowed({ ...local, NODE_ENV: "development" })).toBe(true);
    expect(isLocalStack(local)).toBe(true);
  });

  it("segredos com NEXT_PUBLIC_ e service role na chave pública são erros", () => {
    const serviceJwt = `x.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.y`;
    expect(validateEnv({ ...prod, NEXT_PUBLIC_ANTHROPIC_API_KEY: "k" }).errors.join()).toMatch(/seria exposto/);
    expect(validateEnv({ ...prod, NEXT_PUBLIC_SUPABASE_ANON_KEY: serviceJwt }).errors.join()).toMatch(/service role/);
    expect(validateEnv({ ...prod, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_zzz" }).errors.join()).toMatch(/service role/);
  });

  it("produção exige https, segredo de upload forte e chave da Anthropic; avisa porta do pooler", () => {
    const r = validateEnv({ ...prod, NEXT_PUBLIC_SUPABASE_URL: "http://abc.supabase.co", NEXT_PUBLIC_SITE_URL: undefined, UPLOAD_SIGNING_SECRET: "curto", ANTHROPIC_API_KEY: "", DATABASE_URL: "postgresql://u:p@db.abc.supabase.co:5432/postgres" });
    expect(r.errors.join(" | ")).toMatch(/https.*NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_URL deve usar https/);
    expect(r.errors.join(" | ")).toMatch(/NEXT_PUBLIC_SITE_URL/);
    expect(r.errors.join(" | ")).toMatch(/32 caracteres/);
    expect(r.errors.join(" | ")).toMatch(/ANTHROPIC_API_KEY/);
    expect(r.warnings.join(" | ")).toMatch(/6543/);
  });
});

describe("intenção de upload assinada", () => {
  beforeAll(() => {
    process.env.UPLOAD_SIGNING_SECRET = "s".repeat(40);
  });
  const base = {
    v: 1 as const, kind: "CONTRACT_DOCUMENT" as const, org: "00000000-0000-4000-8000-000000000001", user: "00000000-0000-4000-8000-000000000002",
    bucket: "contract-documents" as const, path: "00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000003.pdf", fileName: "c.pdf",
    mime: "application/pdf", contractId: "00000000-0000-4000-8000-000000000004", versionId: null, documentType: "CONTRACT", importType: null,
    sourceSystem: null, exp: Date.now() + 60_000,
  };

  it("ida e volta preserva o conteúdo", () => {
    expect(decodeIntent(encodeIntent(base))).toEqual(base);
  });

  it("adulteração do conteúdo, assinatura trocada e expiração são rejeitadas", () => {
    const token = encodeIntent(base);
    const [body, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...base, org: "00000000-0000-4000-8000-000000000009" })).toString("base64url");
    expect(() => decodeIntent(`${forged}.${mac}`)).toThrow(/assinatura/);
    expect(() => decodeIntent(`${body}.AAAA`)).toThrow(/assinatura/);
    expect(() => decodeIntent(encodeIntent({ ...base, exp: Date.now() - 1 }))).toThrow(/expirado/);
    process.env.UPLOAD_SIGNING_SECRET = "t".repeat(40);
    expect(() => decodeIntent(token)).toThrow(/assinatura/);
    process.env.UPLOAD_SIGNING_SECRET = "s".repeat(40);
  });

  it("pré-validação declarada: extensão, tamanho e MIME", () => {
    expect(validateDeclared("Contrato.PDF", 1000, "application/pdf", ["pdf"])).toMatchObject({ extension: "pdf", canonicalMime: "application/pdf" });
    expect(() => validateDeclared("x.exe", 10, "", ["pdf"])).toThrow(/Extensão/);
    expect(() => validateDeclared("x.pdf", 21 * 1024 * 1024, "application/pdf", ["pdf"])).toThrow(/excede/);
    expect(() => validateDeclared("x.pdf", 10, "text/html", ["pdf"])).toThrow(/não corresponde/);
    expect(() => validateDeclared("../../etc/x.csv", 10, "text/csv", ["csv"])).not.toThrow();
    expect(validateDeclared("../../etc/x.csv", 10, "text/csv", ["csv"]).fileName).toBe("x.csv");
  });
});
