import postgres from "postgres";

/**
 * Acesso ao Postgres somente pelo servidor (ADR-014).
 *
 * Toda consulta acontece dentro de um de dois escopos explícitos:
 *  - withUserScope: SET LOCAL ROLE authenticated + claims do JWT verificado → RLS aplicada.
 *  - withSystemScope: SET LOCAL ROLE service_role → usado apenas por motores e jobs,
 *    depois que a autorização do usuário foi verificada no escopo de usuário.
 *
 * Não existe API para consultar fora de um escopo.
 */

export type Tx = postgres.TransactionSql<Record<string, never>>;

export interface UserClaims {
  sub: string;
  email?: string;
  role: "authenticated";
}

let pool: postgres.Sql | null = null;

function getPool(): postgres.Sql {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada");
  pool = postgres(url, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    // Pooler em modo transação não suporta prepared statements nomeados.
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    // numeric chega como string (nunca float); date chega como 'YYYY-MM-DD' (sem fuso).
    types: {
      date: {
        to: 1082,
        from: [1082],
        serialize: (x: string) => x,
        parse: (x: string) => x,
      },
    },
    onnotice: () => {},
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end({ timeout: 5 });
  }
}

export async function withUserScope<T>(claims: UserClaims, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!claims.sub) throw new Error("claims sem sub");
  const result = await getPool().begin(async (tx) => {
    await tx.unsafe("set local role authenticated");
    await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
    return fn(tx as unknown as Tx);
  });
  return result as T;
}

export interface SystemActor {
  /** Usuário que originou a execução (registrado na auditoria como ator do SYSTEM). */
  triggeredByUserId: string | null;
}

export async function withSystemScope<T>(actor: SystemActor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const result = await getPool().begin(async (tx) => {
    await tx.unsafe("set local role service_role");
    await tx`select set_config('app.actor_user_id', ${actor.triggeredByUserId ?? ""}, true)`;
    return fn(tx as unknown as Tx);
  });
  return result as T;
}

/** Intenção semântica registrada em audit_logs.metadata.intent para as próximas escritas da transação. */
export async function setAuditIntent(tx: Tx, intent: string): Promise<void> {
  await tx`select set_config('app.audit_action', ${intent}, true)`;
}

/** Erros levantados pelos triggers/constraints com prefixo de código conhecido. */
export function dbErrorCode(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as { message?: string; code?: string };
  const m = /^([A-Z_]{4,40}):/.exec(e.message ?? "");
  if (m) return m[1] ?? null;
  if (e.code === "42501") return "FORBIDDEN";
  if (e.code === "23505") return "UNIQUE_VIOLATION";
  if (e.code === "23P01") return "EXCLUSION_VIOLATION";
  if (e.code === "23514") return "CHECK_VIOLATION";
  if (e.code === "23503") return "FK_VIOLATION";
  return null;
}
