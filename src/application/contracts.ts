import { z } from "zod";
import { setAuditIntent } from "@/infrastructure/db/client";
import { makeIsoDate, parseIsoDate } from "@/domain/competence";
import { assertUuid, requirePermission, userTx, type OrgContext } from "./context";
import { fromDbError, invalid, notFound } from "./errors";

export interface Contract {
  id: string;
  customerId: string;
  customerName: string;
  contractNumber: string;
  title: string;
  status: string;
  startDate: string;
  endDate: string | null;
  renewalType: string | null;
  createdAt: string;
}

export interface ContractVersion {
  id: string;
  versionNumber: number;
  validFrom: string;
  validUntil: string | null;
  sourceType: string;
  status: string;
  notes: string | null;
  createdAt: string;
  supersededAt: string | null;
}

export function mapContract(r: Record<string, unknown>): Contract {
  return {
    id: r.id as string,
    customerId: r.customer_id as string,
    customerName: (r.customer_name as string) ?? "",
    contractNumber: r.contract_number as string,
    title: r.title as string,
    status: r.status as string,
    startDate: r.start_date as string,
    endDate: (r.end_date as string | null) ?? null,
    renewalType: (r.renewal_type as string | null) ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
  };
}

export function mapVersion(r: Record<string, unknown>): ContractVersion {
  return {
    id: r.id as string,
    versionNumber: r.version_number as number,
    validFrom: r.valid_from as string,
    validUntil: (r.valid_until as string | null) ?? null,
    sourceType: r.source_type as string,
    status: r.status as string,
    notes: (r.notes as string | null) ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
    supersededAt: r.superseded_at ? new Date(r.superseded_at as string).toISOString() : null,
  };
}

function isoDate(raw: unknown, label: string): string {
  const d = parseIsoDate(raw);
  if (!d.ok) throw invalid(`${label}: ${d.error}`);
  return d.value;
}

const ContractInput = z.object({
  customerId: z.string().uuid("Cliente obrigatório"),
  contractNumber: z.string().trim().min(1, "Número obrigatório").max(100),
  title: z.string().trim().min(1, "Título obrigatório").max(300),
  startDate: z.string().trim().min(1, "Início obrigatório"),
  endDate: z.string().trim().optional().nullable(),
  renewalType: z.enum(["NONE", "AUTOMATIC", "MANUAL"]).optional().nullable(),
});

/** Cria contrato e sua versão 1 (ORIGINAL, ACTIVE) na mesma transação. */
export async function createContract(ctx: OrgContext, input: unknown): Promise<{ contractId: string; versionId: string }> {
  requirePermission(ctx, "contracts.write");
  const p = ContractInput.safeParse(input);
  if (!p.success) throw invalid(p.error.issues[0]?.message ?? "Dados inválidos");
  const start = isoDate(p.data.startDate, "Início");
  const end = p.data.endDate ? isoDate(p.data.endDate, "Fim") : null;
  if (end && end < start) throw invalid("Fim anterior ao início");
  try {
    return await userTx(ctx, async (tx) => {
      await setAuditIntent(tx, "contract.create");
      const [k] = await tx`
        insert into app.contracts (organization_id, customer_id, contract_number, title, start_date, end_date, renewal_type, created_by)
        values (${ctx.orgId}, ${p.data.customerId}, ${p.data.contractNumber}, ${p.data.title}, ${start}, ${end},
                ${p.data.renewalType ?? null}, ${ctx.userId})
        returning id`;
      const [v] = await tx`
        insert into app.contract_versions (organization_id, contract_id, version_number, valid_from, valid_until, source_type, created_by)
        values (${ctx.orgId}, ${k!.id}, 1, ${start}, ${end}, 'ORIGINAL', ${ctx.userId})
        returning id`;
      return { contractId: k!.id as string, versionId: v!.id as string };
    });
  } catch (e) {
    throw fromDbError(e);
  }
}

const AmendmentInput = z.object({
  validFrom: z.string().trim().min(1),
  notes: z.string().trim().max(2000).optional().nullable(),
  carryRules: z.boolean().default(true),
});

/**
 * Aditivo: encerra a versão vigente no dia anterior e cria nova versão ACTIVE.
 * Regras ativas da versão anterior podem ser copiadas como PROPOSED (mesma proveniência),
 * exigindo nova confirmação humana — nunca são reaproveitadas silenciosamente.
 */
export async function createAmendment(ctx: OrgContext, contractId: string, input: unknown): Promise<string> {
  requirePermission(ctx, "contracts.write");
  assertUuid(contractId);
  const p = AmendmentInput.safeParse(input);
  if (!p.success) throw invalid("Dados do aditivo inválidos");
  const from = isoDate(p.data.validFrom, "Início da vigência");
  const [y, m, d] = from.split("-").map(Number) as [number, number, number];
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  const dayBefore = makeIsoDate(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate())!;
  try {
    return await userTx(ctx, async (tx) => {
      await setAuditIntent(tx, "contract.amendment");
      const versions = await tx`
        select * from app.contract_versions where contract_id = ${contractId} and organization_id = ${ctx.orgId}
        order by version_number desc for update`;
      if (versions.length === 0) throw notFound("Contrato");
      const current = versions.find((v) => v.status === "ACTIVE" && v.valid_until === null);
      if (!current) throw invalid("Não há versão vigente sem data de término para receber aditivo");
      if (from <= (current.valid_from as string)) throw invalid("O aditivo deve iniciar após o início da versão vigente");
      await tx`update app.contract_versions set valid_until = ${dayBefore} where id = ${current.id}`;
      const [nv] = await tx`
        insert into app.contract_versions (organization_id, contract_id, version_number, valid_from, source_type, notes, created_by)
        values (${ctx.orgId}, ${contractId}, ${(versions[0]!.version_number as number) + 1}, ${from}, 'AMENDMENT',
                ${p.data.notes ?? null}, ${ctx.userId})
        returning id`;
      if (p.data.carryRules) {
        await tx`
          insert into app.contract_rules (organization_id, contract_id, contract_version_id, rule_type, numeric_value, text_value,
            unit, valid_from, source_type, source_document_id, source_page, source_text, created_by)
          select organization_id, contract_id, ${nv!.id}, rule_type, numeric_value, text_value, unit, ${from}, 'MANUAL_ENTRY',
                 source_document_id, source_page, source_text, ${ctx.userId}
          from app.contract_rules where contract_version_id = ${current.id} and status = 'ACTIVE'`;
      }
      return nv!.id as string;
    });
  } catch (e) {
    throw fromDbError(e);
  }
}

export async function listContracts(ctx: OrgContext, opts: { customerId?: string } = {}): Promise<Contract[]> {
  return userTx(ctx, async (tx) => {
    const rows = await tx`
      select k.*, coalesce(c.trade_name, c.legal_name) as customer_name
      from app.contracts k join app.customers c on c.id = k.customer_id
      where k.organization_id = ${ctx.orgId} and k.deleted_at is null
        and (${opts.customerId ?? null}::uuid is null or k.customer_id = ${opts.customerId ?? null})
      order by k.contract_number limit 500`;
    return rows.map(mapContract);
  });
}

export async function getContract(ctx: OrgContext, id: string): Promise<{ contract: Contract; versions: ContractVersion[] }> {
  assertUuid(id);
  return userTx(ctx, async (tx) => {
    const [k] = await tx`
      select k.*, coalesce(c.trade_name, c.legal_name) as customer_name
      from app.contracts k join app.customers c on c.id = k.customer_id
      where k.id = ${id} and k.organization_id = ${ctx.orgId}`;
    if (!k) throw notFound("Contrato");
    const versions = await tx`select * from app.contract_versions where contract_id = ${id} order by version_number`;
    return { contract: mapContract(k), versions: versions.map(mapVersion) };
  });
}
