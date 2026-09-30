import { createHash, randomUUID } from "node:crypto";
import { asUser, makeCnpj, type OrgFixture } from "./helpers";

export const CANONICAL_PAGE_TEXT = [
  "CLÁUSULA 4 – DO PREÇO",
  "O CONTRATANTE pagará mensalidade fixa de R$ 18.000,00 (dezoito mil reais).",
  "Estão incluídas 40 horas mensais de suporte técnico.",
  "Cada hora adicional será faturada a R$ 280,00 (duzentos e oitenta reais).",
].join("\n");

let seq = 1;

export interface ContractFixture {
  customerId: string;
  cnpj: string;
  contractId: string;
  versionId: string;
  documentId: string;
}

/** Cliente + contrato + versão 1 ativa + documento com uma página de texto. */
export async function seedContract(
  org: OrgFixture,
  opts: { validFrom?: string; startDate?: string; pageText?: string; name?: string } = {},
): Promise<ContractFixture> {
  const n = seq++ + Math.floor(Math.random() * 1_000_000);
  const cnpj = makeCnpj(n);
  const startDate = opts.startDate ?? "2026-01-01";
  return asUser(org.adminId, async (tx) => {
    const name = opts.name ?? `Indústria ABC ${n}`;
    const [c] = await tx`
      insert into app.customers (organization_id, legal_name, legal_name_normalized, cnpj, created_by)
      values (${org.orgId}, ${name}, ${name.toLowerCase()}, ${cnpj}, ${org.adminId}) returning id`;
    const [k] = await tx`
      insert into app.contracts (organization_id, customer_id, contract_number, title, start_date, created_by)
      values (${org.orgId}, ${c!.id}, ${"C-" + n}, 'Suporte técnico', ${startDate}, ${org.adminId}) returning id`;
    const [v] = await tx`
      insert into app.contract_versions (organization_id, contract_id, version_number, valid_from, source_type, created_by)
      values (${org.orgId}, ${k!.id}, 1, ${opts.validFrom ?? startDate}, 'ORIGINAL', ${org.adminId}) returning id`;
    const docId = randomUUID();
    const [d] = await tx`
      insert into app.contract_documents (id, organization_id, contract_id, contract_version_id, storage_path,
        file_name, mime_type, file_size, sha256_hash, document_type, page_count, text_status, uploaded_by)
      values (${docId}, ${org.orgId}, ${k!.id}, ${v!.id}, ${org.orgId + "/" + docId + ".pdf"},
        'Contrato.pdf', 'application/pdf', 1000, ${createHash("sha256").update(docId).digest("hex")},
        'CONTRACT', 1, 'COMPLETED', ${org.adminId}) returning id`;
    const text = opts.pageText ?? CANONICAL_PAGE_TEXT;
    await tx`
      insert into app.contract_document_pages (organization_id, document_id, page_number, text, text_sha256)
      values (${org.orgId}, ${d!.id}, 1, ${text}, ${createHash("sha256").update(text).digest("hex")})`;
    return { customerId: c!.id, cnpj, contractId: k!.id, versionId: v!.id, documentId: d!.id };
  });
}

export async function insertManualRule(
  org: OrgFixture,
  k: ContractFixture,
  rule: { type: string; value: string; unit?: string | null; excerpt: string; validFrom?: string; versionId?: string },
): Promise<string> {
  return asUser(org.adminId, async (tx) => {
    const [r] = await tx`
      insert into app.contract_rules (organization_id, contract_id, contract_version_id, rule_type, numeric_value,
        unit, valid_from, source_type, source_document_id, source_text, created_by)
      values (${org.orgId}, ${k.contractId}, ${rule.versionId ?? k.versionId}, ${rule.type}, ${rule.value},
        ${rule.unit ?? null}, ${rule.validFrom ?? "2026-01-01"}, 'MANUAL_ENTRY', ${k.documentId}, ${rule.excerpt},
        ${org.adminId})
      returning id`;
    return r!.id as string;
  });
}

export async function confirmAndActivate(org: OrgFixture, ruleId: string): Promise<void> {
  await asUser(org.adminId, async (tx) => {
    await tx`update app.contract_rules set status = 'CONFIRMED', confirmed_by = ${org.adminId}, confirmed_at = now()
             where id = ${ruleId}`;
    await tx`update app.contract_rules set status = 'ACTIVE', activated_by = ${org.adminId}, activated_at = now()
             where id = ${ruleId}`;
  });
}

/** Regras do cenário canônico ativas: 18.000 + 40 h + 280/h. */
export async function seedCanonicalRules(org: OrgFixture, k: ContractFixture): Promise<Record<string, string>> {
  const fee = await insertManualRule(org, k, { type: "FIXED_MONTHLY_FEE", value: "18000.00", excerpt: "mensalidade fixa de R$ 18.000,00" });
  const inc = await insertManualRule(org, k, { type: "INCLUDED_QUANTITY", value: "40", unit: "HOUR", excerpt: "Estão incluídas 40 horas mensais" });
  const exc = await insertManualRule(org, k, { type: "EXCESS_UNIT_PRICE", value: "280", unit: "HOUR", excerpt: "Cada hora adicional será faturada a R$ 280,00" });
  for (const id of [fee, inc, exc]) await confirmAndActivate(org, id);
  return { fee, inc, exc };
}
