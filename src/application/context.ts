import { withSystemScope, withUserScope, type Tx } from "@/infrastructure/db/client";
import { AppError, forbidden } from "./errors";

export type Role = "ADMIN" | "FINANCE" | "COMMERCIAL" | "AUDITOR" | "EXECUTIVE";

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrador",
  FINANCE: "Financeiro",
  COMMERCIAL: "Comercial",
  AUDITOR: "Auditor",
  EXECUTIVE: "Executivo",
};

/** Matriz de permissões da aplicação (espelha as políticas RLS — ADR-015). */
export const PERMISSIONS = {
  "customers.write": ["ADMIN", "COMMERCIAL"],
  "contracts.write": ["ADMIN", "COMMERCIAL"],
  "documents.write": ["ADMIN", "COMMERCIAL"],
  "documents.download": ["ADMIN", "COMMERCIAL", "FINANCE", "AUDITOR"],
  "rules.propose": ["ADMIN", "COMMERCIAL"],
  "rules.review": ["ADMIN"],
  "imports.read": ["ADMIN", "FINANCE", "AUDITOR"],
  "imports.write": ["ADMIN", "FINANCE"],
  "matches.decide": ["ADMIN", "FINANCE"],
  "calculations.run": ["ADMIN", "FINANCE"],
  "findings.classify": ["ADMIN", "FINANCE"],
  "findings.review": ["ADMIN", "FINANCE", "AUDITOR"],
  "materiality.write": ["ADMIN"],
  "members.manage": ["ADMIN"],
  "audit.read": ["ADMIN", "AUDITOR"],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof PERMISSIONS;

export interface OrgContext {
  userId: string;
  email?: string;
  orgId: string;
  role: Role;
  orgName: string;
}

export function can(ctx: Pick<OrgContext, "role">, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(ctx.role);
}

export function requirePermission(ctx: OrgContext, permission: Permission): void {
  if (!can(ctx, permission)) throw forbidden();
}

export function userTx<T>(ctx: Pick<OrgContext, "userId" | "email">, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withUserScope({ sub: ctx.userId, email: ctx.email, role: "authenticated" }, fn);
}

export function systemTx<T>(ctx: Pick<OrgContext, "userId"> | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withSystemScope({ triggeredByUserId: ctx?.userId ?? null }, fn);
}

export interface Membership {
  orgId: string;
  orgName: string;
  role: Role;
}

export async function listMemberships(userId: string): Promise<Membership[]> {
  return withUserScope({ sub: userId, role: "authenticated" }, async (tx) => {
    const rows = await tx`
      select o.id, coalesce(o.trade_name, o.legal_name) as name, ou.role
      from app.organization_users ou join app.organizations o on o.id = ou.organization_id
      where ou.user_id = ${userId} and ou.status = 'ACTIVE' and o.deleted_at is null
      order by name`;
    return rows.map((r) => ({ orgId: r.id as string, orgName: r.name as string, role: r.role as Role }));
  });
}

/** Revalida a cada requisição o vínculo ativo do usuário com a organização escolhida. */
export async function resolveOrgContext(user: { id: string; email?: string }, orgId: string | null): Promise<OrgContext | null> {
  await withUserScope({ sub: user.id, role: "authenticated" }, (tx) => tx`select app.accept_pending_invitations()`);
  const memberships = await listMemberships(user.id);
  const m = memberships.find((x) => x.orgId === orgId) ?? memberships[0];
  if (!m) return null;
  return { userId: user.id, email: user.email, orgId: m.orgId, role: m.role, orgName: m.orgName };
}

export function assertUuid(value: string, label = "id"): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new AppError("VALIDATION", `${label} inválido`, 422);
  }
  return value.toLowerCase();
}
