import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { withSystemScope, withUserScope, type Tx } from "@/infrastructure/db/client";

/**
 * Harness de integração: Postgres real do Supabase local (supabase start).
 * Usuários são inseridos diretamente em auth.users (o trigger cria app.users).
 * Cada teste usa organizações novas — não há dependência de ordem entre arquivos.
 */

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: postgres.Sql<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function adminSql(): postgres.Sql<any> {
  admin ??= postgres(process.env.DATABASE_URL!, {
    max: 2, prepare: false, onnotice: () => {},
    types: { date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x } },
  });
  return admin;
}

export async function createUser(label = "user"): Promise<string> {
  const id = randomUUID();
  const email = `${label}-${id.slice(0, 8)}@test.local`;
  await adminSql()`
    insert into auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
    values (${id}, ${email}, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
            ${adminSql().json({ full_name: label })})`;
  return id;
}

export function asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withUserScope({ sub: userId, role: "authenticated" }, fn);
}

export function asSystem<T>(userId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withSystemScope({ triggeredByUserId: userId }, fn);
}

export type Role = "ADMIN" | "FINANCE" | "COMMERCIAL" | "AUDITOR" | "EXECUTIVE";

export interface OrgFixture {
  orgId: string;
  adminId: string;
  members: Record<Role, string>;
}

/** Organização com um usuário ativo por papel. */
export async function createOrg(name = "Org"): Promise<OrgFixture> {
  const adminId = await createUser(`${name}-admin`);
  const orgId = await asUser(adminId, async (tx) => {
    const [row] = await tx`select app.create_organization(${name + " Ltda"}, ${name}, null) as id`;
    return row!.id as string;
  });
  const members = { ADMIN: adminId } as Record<Role, string>;
  for (const role of ["FINANCE", "COMMERCIAL", "AUDITOR", "EXECUTIVE"] as const) {
    const uid = await createUser(`${name}-${role.toLowerCase()}`);
    await asUser(adminId, (tx) => tx`
      insert into app.organization_users (organization_id, user_id, role, status, invited_by)
      values (${orgId}, ${uid}, ${role}, 'INVITED', ${adminId})`);
    await asUser(uid, (tx) => tx`select app.accept_pending_invitations()`);
    members[role] = uid;
  }
  return { orgId, adminId, members };
}

export { makeCnpj } from "../support/cnpj";

export async function expectDbError(p: Promise<unknown>, pattern: RegExp): Promise<void> {
  let error: unknown = null;
  try {
    await p;
  } catch (e) {
    error = e;
  }
  if (!error) throw new Error(`esperava erro ${pattern}, mas a operação foi aceita`);
  const msg = `${(error as { code?: string }).code ?? ""} ${(error as Error).message}`;
  if (!pattern.test(msg)) throw new Error(`erro inesperado: ${msg} (esperado ${pattern})`);
}
