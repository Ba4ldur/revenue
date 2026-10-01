import { z } from "zod";
import { isValidCnpj, normalizeCnpj } from "@/domain/cnpj";
import { normalizeName } from "@/domain/entity-resolution/entity-resolution";
import { setAuditIntent } from "@/infrastructure/db/client";
import { assertUuid, requirePermission, userTx, type OrgContext } from "./context";
import { fromDbError, invalid, notFound } from "./errors";

export interface Customer {
  id: string;
  legalName: string;
  tradeName: string | null;
  cnpj: string | null;
  externalId: string | null;
  status: string;
  createdAt: string;
  deletedAt: string | null;
}

export function mapCustomer(r: Record<string, unknown>): Customer {
  return {
    id: r.id as string,
    legalName: r.legal_name as string,
    tradeName: (r.trade_name as string | null) ?? null,
    cnpj: (r.cnpj as string | null) ?? null,
    externalId: (r.external_id as string | null) ?? null,
    status: r.status as string,
    createdAt: new Date(r.created_at as string).toISOString(),
    deletedAt: r.deleted_at ? new Date(r.deleted_at as string).toISOString() : null,
  };
}

const CustomerInput = z.object({
  legalName: z.string().trim().min(2, "Razão social obrigatória").max(300),
  tradeName: z.string().trim().max(300).optional().nullable(),
  cnpj: z.string().trim().max(30).optional().nullable(),
  externalId: z.string().trim().max(200).optional().nullable(),
});

function prepare(input: unknown) {
  const p = CustomerInput.safeParse(input);
  if (!p.success) throw invalid(p.error.issues[0]?.message ?? "Dados inválidos");
  const cnpj = p.data.cnpj ? normalizeCnpj(p.data.cnpj) : null;
  if (cnpj && !isValidCnpj(cnpj)) throw invalid("CNPJ inválido (dígito verificador)");
  const tradeName = p.data.tradeName || null;
  return {
    legalName: p.data.legalName,
    tradeName,
    cnpj,
    externalId: p.data.externalId || null,
    legalNameNormalized: normalizeName(p.data.legalName) || p.data.legalName.toLowerCase(),
    tradeNameNormalized: tradeName ? normalizeName(tradeName) || null : null,
  };
}

export async function createCustomer(ctx: OrgContext, input: unknown): Promise<string> {
  requirePermission(ctx, "customers.write");
  const c = prepare(input);
  try {
    return await userTx(ctx, async (tx) => {
      await setAuditIntent(tx, "customer.create");
      const [r] = await tx`
        insert into app.customers (organization_id, legal_name, trade_name, legal_name_normalized, trade_name_normalized,
          cnpj, external_id, created_by)
        values (${ctx.orgId}, ${c.legalName}, ${c.tradeName}, ${c.legalNameNormalized}, ${c.tradeNameNormalized},
          ${c.cnpj}, ${c.externalId}, ${ctx.userId})
        returning id`;
      return r!.id as string;
    });
  } catch (e) {
    throw fromDbError(e);
  }
}

export async function updateCustomer(ctx: OrgContext, id: string, input: unknown): Promise<void> {
  requirePermission(ctx, "customers.write");
  assertUuid(id);
  const c = prepare(input);
  try {
    await userTx(ctx, async (tx) => {
      await setAuditIntent(tx, "customer.update");
      const r = await tx`
        update app.customers set legal_name = ${c.legalName}, trade_name = ${c.tradeName},
          legal_name_normalized = ${c.legalNameNormalized}, trade_name_normalized = ${c.tradeNameNormalized},
          cnpj = ${c.cnpj}, external_id = ${c.externalId}
        where id = ${id} and organization_id = ${ctx.orgId} and deleted_at is null`;
      if (r.count === 0) throw notFound("Cliente");
    });
  } catch (e) {
    throw fromDbError(e);
  }
}

export async function listCustomers(ctx: OrgContext, opts: { q?: string } = {}): Promise<Array<Customer & { contractCount: number }>> {
  return userTx(ctx, async (tx) => {
    const q = opts.q?.trim() ? `%${opts.q.trim().toLowerCase()}%` : null;
    const rows = await tx`
      select c.*, (select count(*)::int from app.contracts k where k.customer_id = c.id and k.deleted_at is null) as contract_count
      from app.customers c
      where c.organization_id = ${ctx.orgId} and c.deleted_at is null
        and (${q}::text is null or lower(c.legal_name) like ${q} or coalesce(c.cnpj, '') like ${q})
      order by c.legal_name limit 500`;
    return rows.map((r) => ({ ...mapCustomer(r), contractCount: r.contract_count as number }));
  });
}

export async function getCustomer(ctx: OrgContext, id: string): Promise<Customer> {
  assertUuid(id);
  return userTx(ctx, async (tx) => {
    const [r] = await tx`select * from app.customers where id = ${id} and organization_id = ${ctx.orgId}`;
    if (!r) throw notFound("Cliente");
    return mapCustomer(r);
  });
}
