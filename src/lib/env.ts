/**
 * Validação central de variáveis de ambiente (sem dependência de Next — testável).
 * Executada no boot do servidor (src/instrumentation.ts): em produção, erro impede a inicialização.
 * Nunca registra valores, só nomes das variáveis.
 */
type Env = Record<string, string | undefined>;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function host(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Stack totalmente local (Supabase CLI): Auth/Storage e Postgres em loopback e fora da Vercel. */
export function isLocalStack(env: Env): boolean {
  const a = host(env.NEXT_PUBLIC_SUPABASE_URL);
  const d = host(env.DATABASE_URL);
  return !env.VERCEL && a !== null && d !== null && LOOPBACK.has(a) && LOOPBACK.has(d);
}

/**
 * O dublê determinístico de extração (não é IA) só é permitido com stack local. Fora dela —
 * inclusive em desenvolvimento apontando para um projeto Supabase real — é recusado, para não
 * gerar regras propostas falsas em dados reais. Em `next start` local (NODE_ENV=production)
 * exige ainda ALLOW_TEST_PROVIDER=1 (usado apenas pelo E2E).
 */
export function testProviderAllowed(env: Env): boolean {
  if (!isLocalStack(env)) return false;
  return env.NODE_ENV !== "production" || env.ALLOW_TEST_PROVIDER === "1";
}

function jwtRole(token: string | undefined): string | null {
  if (!token || token.split(".").length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as { role?: string };
    return payload.role ?? null;
  } catch {
    return null;
  }
}

export interface EnvReport {
  errors: string[];
  warnings: string[];
  production: boolean;
  local: boolean;
}

export function validateEnv(env: Env): EnvReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const local = isLocalStack(env);
  const production = env.NODE_ENV === "production" && !local;

  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL", "UPLOAD_SIGNING_SECRET"]) {
    if (!env[name]?.trim()) errors.push(`${name} não definida`);
  }
  if (env.UPLOAD_SIGNING_SECRET && env.UPLOAD_SIGNING_SECRET.length < 32) errors.push("UPLOAD_SIGNING_SECRET deve ter ao menos 32 caracteres");

  // Segredos nunca podem ir para o bundle do cliente.
  for (const name of Object.keys(env)) {
    if (name.startsWith("NEXT_PUBLIC_") && /SERVICE_ROLE|SECRET|ANTHROPIC|DATABASE|PASSWORD|UPLOAD_SIGNING/.test(name)) {
      errors.push(`${name}: segredo com prefixo NEXT_PUBLIC_ seria exposto no navegador`);
    }
  }
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (anon && (anon.startsWith("sb_secret_") || jwtRole(anon) === "service_role")) {
    errors.push("NEXT_PUBLIC_SUPABASE_ANON_KEY contém uma chave de service role (seria exposta no navegador)");
  }
  if (env.SUPABASE_SERVICE_ROLE_KEY && anon && env.SUPABASE_SERVICE_ROLE_KEY === anon) {
    errors.push("SUPABASE_SERVICE_ROLE_KEY igual à chave anônima");
  }

  const provider = env.AI_PROVIDER?.trim() ?? "";
  if (provider && !["anthropic", "deterministic-test"].includes(provider)) errors.push(`AI_PROVIDER desconhecido: ${provider}`);
  if (provider === "anthropic" && !env.ANTHROPIC_API_KEY?.trim()) errors.push("AI_PROVIDER=anthropic exige ANTHROPIC_API_KEY");
  if (provider === "deterministic-test" && !testProviderAllowed(env)) {
    errors.push("AI_PROVIDER=deterministic-test só é permitido com Supabase e Postgres locais (dublê de teste, não é IA)");
  }
  if (!provider) warnings.push("AI_PROVIDER vazio: extração por IA desabilitada (regras somente manuais)");

  if (production) {
    if (env.ALLOW_TEST_PROVIDER) errors.push("ALLOW_TEST_PROVIDER não pode ser definida em produção");
    if (!env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("https://")) errors.push("NEXT_PUBLIC_SUPABASE_URL deve usar https em produção");
    if (!env.NEXT_PUBLIC_SITE_URL?.startsWith("https://")) errors.push("NEXT_PUBLIC_SITE_URL deve ser definida com https em produção");
    try {
      const u = new URL(env.DATABASE_URL ?? "");
      if (u.port !== "6543") warnings.push("DATABASE_URL não usa a porta 6543 (pooler em modo transação recomendado para serverless)");
    } catch {
      errors.push("DATABASE_URL inválida");
    }
  }
  return { errors, warnings, production, local };
}
