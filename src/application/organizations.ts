import { z } from "zod";
import { isValidCnpj, normalizeCnpj } from "@/domain/cnpj";
import { setAuditIntent, withUserScope } from "@/infrastructure/db/client";
import { requirePermission, systemTx, userTx, type OrgContext, type Role } from "./context";
import { fromDbError, invalid } from "./errors";
import { validatePolicy, type MaterialityPolicy } from "@/domain/reconciliation/materiality";
import { dec } from "@/domain/money/decimal";

const OrgInput = z.object({
  legalName: z.string().trim().min(2).max(300),
  tradeName: z.string().trim().max(300).optional().nullable(),
  cnpj: z.string().trim().optional().nullable(),
});

export async function createOrganization(user: { id: string; email?: string }, input: unknown): Promise<string> {
  const p = OrgInput.safeParse(input);
  if (!p.success) throw invalid("Dados da organização inválidos");
  const cnpj = p.data.cnpj ? normalizeCnpj(p.data.cnpj) : null;
  if (cnpj && !isValidCnpj(cnpj)) throw invalid("CNPJ inválido");
  try {
    return await withUserScope({ sub: user.id, email: user.email, role: "authenticated" }, async (tx) => {
      const [r] = await tx`select app.create_organization(${p.data.legalName}, ${p.data.tradeName ?? null}, ${cnpj}) as id`;
      return r!.id as string;
    });
  } catch (e) {
    throw fromDbError(e);
  }
}

export interface MemberRow {
  id: string;
  userId: string;
  email: string;
  fullName: string | null;
  role: Role;
  status: string;
  joinedAt: string | null;
}

export async function listMembers(ctx: OrgContext): Promise<MemberRow[]> {
  return userTx(ctx, async (tx) => {
    const rows = await tx`
      select ou.id, ou.user_id, u.email, u.full_name, ou.role, ou.status, ou.joined_at
      from app.organization_users ou join app.users u on u.id = ou.user_id
      where ou.organization_id = ${ctx.orgId} order by u.email`;
    return rows.map((r) => ({
      id: r.id, userId: r.user_id, email: r.email, fullName: r.full_name, role: r.role, status: r.status,
      joinedAt: r.joined_at ? new Date(r.joined_at).toISOString() : null,
    }));
  });
}

const InviteInput = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  role: z.enum(["ADMIN", "FINANCE", "COMMERCIAL", "AUDITOR", "EXECUTIVE"]),
});

/**
 * Convite: o usuário é criado/convidado no Supabase Auth (e-mail enviado pelo Auth) e o vínculo
 * nasce INVITED; ele fica ACTIVE no primeiro acesso do convidado.
 */
export async function inviteMember(
  ctx: OrgContext,
  input: unknown,
  authAdmin: { inviteOrGetUserId(email: string): Promise<string> },
): Promise<void> {
  requirePermission(ctx, "members.manage");
  const p = InviteInput.safeParse(input);
  if (!p.success) throw invalid("E-mail ou papel inválido");
  const userId = await authAdmin.inviteOrGetUserId(p.data.email);
  try {
    await userTx(ctx, async (tx) => {
      await setAuditIntent(tx, "member.invite");
      await tx`insert into app.organization_users (organization_id, user_id, role, status, invited_by)
               values (${ctx.orgId}, ${userId}, ${p.data.role}, 'INVITED', ${ctx.userId})`;
    });
  } catch (e) {
    throw fromDbError(e);
  }
}

const MemberUpdate = z.object({
  memberId: z.string().uuid(),
  role: z.enum(["ADMIN", "FINANCE", "COMMERCIAL", "AUDITOR", "EXECUTIVE"]).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});

export async function updateMember(ctx: OrgContext, input: unknown): Promise<void> {
  requirePermission(ctx, "members.manage");
  const p = MemberUpdate.safeParse(input);
  if (!p.success) throw invalid("Alteração inválida");
  try {
    await userTx(ctx, async (tx) => {
      await setAuditIntent(tx, "member.update");
      const [m] = await tx`select status, joined_at from app.organization_users where id = ${p.data.memberId} and organization_id = ${ctx.orgId}`;
      if (!m) throw invalid("Membro não encontrado");
      if (p.data.status === "ACTIVE" && m.status === "INVITED") throw invalid("Convite pendente só é ativado pelo próprio convidado");
      await tx`update app.organization_users
               set role = coalesce(${p.data.role ?? null}, role), status = coalesce(${p.data.status ?? null}, status)
               where id = ${p.data.memberId} and organization_id = ${ctx.orgId}`;
    });
  } catch (e) {
    throw fromDbError(e);
  }
}

// ---------------------------------------------------------------------------------------
// Materialidade
// ---------------------------------------------------------------------------------------

export interface MaterialityRow extends MaterialityPolicy {
  status: string;
  createdAt: string;
  createdByEmail: string | null;
}

export async function listMaterialityPolicies(ctx: OrgContext): Promise<MaterialityRow[]> {
  return userTx(ctx, async (tx) => {
    const rows = await tx`
      select m.*, u.email from app.materiality_policies m left join app.users u on u.id = m.created_by
      where m.organization_id = ${ctx.orgId} order by m.version desc`;
    return rows.map(mapMateriality);
  });
}

export function mapMateriality(r: Record<string, unknown>): MaterialityRow {
  return {
    id: r.id as string,
    version: r.version as number,
    mode: r.mode as MaterialityPolicy["mode"],
    absoluteThreshold: (r.absolute_threshold as string | null) ?? null,
    percentageThreshold: (r.percentage_threshold as string | null) ?? null,
    combinationOperator: (r.combination_operator as MaterialityPolicy["combinationOperator"]) ?? null,
    status: r.status as string,
    createdAt: new Date(r.created_at as string).toISOString(),
    createdByEmail: (r.email as string | null) ?? null,
  };
}

const MaterialityInput = z.object({
  mode: z.enum(["ABSOLUTE", "PERCENTAGE", "COMBINED"]),
  absoluteThreshold: z.string().trim().nullable(),
  /** Em pontos percentuais na interface ("1" = 1%); convertido para fração. */
  percentagePoints: z.string().trim().nullable(),
  combinationOperator: z.enum(["AND", "OR"]).nullable(),
});

export async function setMaterialityPolicy(ctx: OrgContext, input: unknown): Promise<string> {
  requirePermission(ctx, "materiality.write");
  const p = MaterialityInput.safeParse(input);
  if (!p.success) throw invalid("Política inválida");
  const toDec = (s: string | null) => (s === null || s === "" ? null : s.replace(",", "."));
  let abs: string | null = null;
  let pct: string | null = null;
  try {
    abs = toDec(p.data.absoluteThreshold) === null ? null : dec(toDec(p.data.absoluteThreshold)!).toFixed(2);
    pct = toDec(p.data.percentagePoints) === null ? null : dec(toDec(p.data.percentagePoints)!).dividedBy(100).toFixed(8);
  } catch {
    throw invalid("Valores numéricos inválidos");
  }
  const policy = {
    mode: p.data.mode,
    absoluteThreshold: p.data.mode === "PERCENTAGE" ? null : abs,
    percentageThreshold: p.data.mode === "ABSOLUTE" ? null : pct,
    combinationOperator: p.data.mode === "COMBINED" ? p.data.combinationOperator : null,
  };
  const errors = validatePolicy(policy);
  if (errors.length) throw invalid(errors.join("; "));
  try {
    return await userTx(ctx, async (tx) => {
      await setAuditIntent(tx, "materiality.change");
      const [r] = await tx`select app.set_materiality_policy(${ctx.orgId}, ${policy.mode}, ${policy.absoluteThreshold},
                                                              ${policy.percentageThreshold}, ${policy.combinationOperator}) as id`;
      return r!.id as string;
    });
  } catch (e) {
    throw fromDbError(e);
  }
}

/** Para o motor: política ACTIVE (leitura de sistema, já autorizado). */
export async function activeMaterialityForSystem(orgId: string): Promise<MaterialityPolicy> {
  return systemTx(null, async (tx) => {
    const [r] = await tx`select * from app.materiality_policies where organization_id = ${orgId} and status = 'ACTIVE'`;
    if (!r) throw invalid("Organização sem política de materialidade ativa");
    return mapMateriality(r);
  });
}
