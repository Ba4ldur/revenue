/**
 * Seed de demonstração (SEED_DATA). Usa os serviços da aplicação — mesmas validações, RLS e
 * auditoria do uso real. Somente para ambiente local/demonstração.
 *
 *   npm run seed:demo        (requer `supabase start` e .env.local)
 *
 * Cenários: canônico (Indústria ABC, R$ 4.760), cobrança abaixo, cliente sem faturamento,
 * desconto autorizado (sem finding), falso positivo, segunda versão contratual e match proposto.
 */
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const envPath = new URL("../.env.local", import.meta.url);
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2];
  }
}
if (process.env.NODE_ENV === "production") throw new Error("seed de demonstração não roda em produção");

const { createOrganization } = await import("../src/application/organizations");
const { resolveOrgContext } = await import("../src/application/context");
const { createCustomer } = await import("../src/application/customers");
const { createAmendment, createContract } = await import("../src/application/contracts");
const { uploadContractDocument } = await import("../src/application/documents");
const { activateRule, confirmRule, createManualRule, extractRulesFromDocument, listRules } = await import("../src/application/rules");
const { processImport, uploadImport } = await import("../src/application/imports/imports");
const { runRevenueAssurance } = await import("../src/application/calculations");
const { classifyFinding } = await import("../src/application/findings");
const { closePool } = await import("../src/infrastructure/db/client");
const { DeterministicTestExtractionProvider } = await import("../src/ai/test-provider");
const { makeTextPdf } = await import("../tests/support/pdf");
const { makeCnpj } = await import("../tests/support/cnpj");

const EMAIL = "demo@acme.test";
const PASSWORD = "DemoAcme2026";
const provider = new DeterministicTestExtractionProvider();

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
let userId: string;
const created = await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true, user_metadata: { full_name: "Ana (demo)" } });
if (created.data.user) userId = created.data.user.id;
else {
  const list = await admin.auth.admin.listUsers({ perPage: 1000 });
  const u = list.data.users.find((x) => x.email === EMAIL);
  if (!u) throw new Error(`não foi possível criar/obter usuário demo: ${created.error?.message}`);
  userId = u.id;
}
const user = { id: userId, email: EMAIL };
if (await resolveOrgContext(user, null)) {
  console.log(`Demo já existe. Entre com ${EMAIL} / ${PASSWORD}`);
  await closePool();
  process.exit(0);
}
await createOrganization(user, { legalName: "Acme Serviços Técnicos Ltda.", tradeName: "Acme" });
const ctx = (await resolveOrgContext(user, null))!;

// CNPJs sintéticos (DV válido, base gerada) — nunca usar CNPJ de empresa real em dado fictício.
const CNPJS = { abc: makeCnpj(48213907), beta: makeCnpj(48213915), gama: makeCnpj(48213923), delta: makeCnpj(48213931), epsilon: makeCnpj(48213949), zeta: makeCnpj(48213957) };

async function contract(name: string, cnpj: string, number: string, pages: string[][]) {
  const customerId = await createCustomer(ctx, { legalName: name, cnpj });
  const { contractId, versionId } = await createContract(ctx, { customerId, contractNumber: number, title: "Prestação de serviços técnicos", startDate: "2026-01-01" });
  const { documentId } = await uploadContractDocument(ctx, { contractId, contractVersionId: versionId, documentType: "CONTRACT", file: { name: `Contrato-${number}.pdf`, type: "application/pdf", bytes: makeTextPdf(pages) } });
  await extractRulesFromDocument(ctx, documentId, provider);
  return { customerId, contractId, versionId, documentId };
}
async function approveAll(contractId: string) {
  for (const r of await listRules(ctx, contractId)) {
    if (r.status === "PROPOSED") await confirmRule(ctx, r.id);
  }
  for (const r of await listRules(ctx, contractId)) {
    if (r.status === "CONFIRMED") await activateRule(ctx, r.id);
  }
}
const fee = (v: string) => [["CLÁUSULA 4 - DO PREÇO", `O CONTRATANTE pagará mensalidade fixa de R$ ${v} mensais.`]];

// 1. Canônico
const abc = await contract("Indústria ABC S.A.", CNPJS.abc, "00921", [
  ["CONTRATO DE PRESTAÇÃO DE SERVIÇOS TÉCNICOS Nº 00921", "CONTRATANTE: Indústria ABC S.A."],
  ["CLÁUSULA 4 - DO PREÇO", "O CONTRATANTE pagará mensalidade fixa de R$ 18.000,00 (dezoito mil reais).", "Estão incluídas 40 horas mensais de suporte técnico.", "Cada hora adicional será faturada a R$ 280,00 (duzentos e oitenta reais)."],
]);
await approveAll(abc.contractId);
// 2. Cobrança abaixo
const beta = await contract("Logística Beta Ltda.", CNPJS.beta, "01033", fee("20.000,00"));
await approveAll(beta.contractId);
// 3. Cliente sem faturamento
const gama = await contract("Hospital Gama S.A.", CNPJS.gama, "01102", fee("18.000,00"));
await approveAll(gama.contractId);
// 4. Desconto autorizado
const delta = await contract("Varejo Delta Ltda.", CNPJS.delta, "01250", [["CLÁUSULA 4 - DO PREÇO", "O CONTRATANTE pagará mensalidade fixa de R$ 20.000,00 mensais.", "Fica concedido desconto fixo de R$ 1.500,00 por mês durante a vigência."]]);
const disc = await createManualRule(ctx, { contractVersionId: delta.versionId, sourceDocumentId: delta.documentId, ruleType: "DISCOUNT_FIXED", value: "1.500,00", validFrom: "2026-01-01", sourceText: "desconto fixo de R$ 1.500,00 por mês" });
await approveAll(delta.contractId);
void disc;
// 5. Falso positivo
const eps = await contract("Construtora Épsilon Ltda.", CNPJS.epsilon, "01310", fee("12.000,00"));
await approveAll(eps.contractId);
// 6. Segunda versão contratual (aditivo a partir de 07/2026)
const zeta = await contract("Agro Zeta S.A.", CNPJS.zeta, "01404", fee("18.000,00"));
await approveAll(zeta.contractId);
const v2 = await createAmendment(ctx, zeta.contractId, { validFrom: "2026-07-01", notes: "Aditivo nº 1 — nova mensalidade", carryRules: false });
const add = await uploadContractDocument(ctx, { contractId: zeta.contractId, contractVersionId: v2, documentType: "AMENDMENT", file: { name: "Aditivo-01404-1.pdf", type: "application/pdf", bytes: makeTextPdf([["TERMO ADITIVO Nº 1", "A partir de 01/07/2026 o CONTRATANTE pagará mensalidade fixa de R$ 20.000,00 mensais."]]) } });
await extractRulesFromDocument(ctx, add.documentId, provider);
await approveAll(zeta.contractId);

// Operação e faturamento
const csv = (s: string) => ({ name: "dados.csv", type: "text/csv", bytes: new TextEncoder().encode(s) });
const op = await uploadImport(ctx, { type: "OPERATIONAL", sourceSystem: "planilha de horas", file: csv(`CNPJ;Cliente;Competência;Horas;Descrição\n${CNPJS.abc};Indústria ABC;09/2026;30;Chamados corretivos\n${CNPJS.abc};Indústria ABC;09/2026;27;Visitas técnicas\n`) });
await processImport(ctx, op.importId, { cnpj: "CNPJ", customer_name: "Cliente", competence: "Competência", quantity: "Horas", description: "Descrição" }, { numberFormat: "BR", competence: { mode: "COLUMN" }, defaultUnit: "HOUR", defaultEventType: "SUPORTE" });
const bill = await uploadImport(ctx, { type: "BILLING", sourceSystem: "ERP", file: csv([
  "CNPJ;Cliente;Competência;Valor;Emissão;NF",
  `${CNPJS.abc};Indústria ABC;09/2026;18.000,00;05/10/2026;1234`,
  `${CNPJS.beta};Logística Beta;09/2026;18.500,00;05/10/2026;1235`,
  `${CNPJS.delta};Varejo Delta;09/2026;18.500,00;05/10/2026;1236`,
  `${CNPJS.epsilon};Construtora Épsilon;09/2026;10.000,00;05/10/2026;1237`,
  `${CNPJS.zeta};Agro Zeta;05/2026;18.000,00;05/06/2026;1180`,
  `${CNPJS.zeta};Agro Zeta;08/2026;18.000,00;05/09/2026;1215`,
].join("\n")) });
await processImport(ctx, bill.importId, { cnpj: "CNPJ", customer_name: "Cliente", competence: "Competência", amount: "Valor", date: "Emissão", document_number: "NF" }, { numberFormat: "BR", competence: { mode: "COLUMN" } });
// 7. Match proposto: NF sem CNPJ e com nome aproximado — fica pendente para decisão humana
const pend = await uploadImport(ctx, { type: "BILLING", sourceSystem: "planilha manual", file: csv("Tomador;Competência;Valor;Emissão;NF\nHospital Gamma;10/2026;18.000,00;05/11/2026;1301\n") });
await processImport(ctx, pend.importId, { customer_name: "Tomador", competence: "Competência", amount: "Valor", date: "Emissão", document_number: "NF" }, { numberFormat: "BR", competence: { mode: "COLUMN" } });

// Cálculos
const results: Array<[string, string, Awaited<ReturnType<typeof runRevenueAssurance>>]> = [];
for (const [label, k, c] of [["Indústria ABC", abc, "2026-09-01"], ["Logística Beta", beta, "2026-09-01"], ["Hospital Gama", gama, "2026-09-01"],
  ["Varejo Delta", delta, "2026-09-01"], ["Construtora Épsilon", eps, "2026-09-01"], ["Agro Zeta (v1)", zeta, "2026-05-01"], ["Agro Zeta (v2)", zeta, "2026-08-01"]] as const) {
  results.push([label, c, await runRevenueAssurance(ctx, k.contractId, c)]);
}
const epsFinding = results.find((r) => r[0] === "Construtora Épsilon")![2].findingId!;
await classifyFinding(ctx, epsFinding, { action: "START_REVIEW" });
await classifyFinding(ctx, epsFinding, { action: "MARK_FALSE_POSITIVE", reason: "Mês de carência contratual negociado por e-mail; regra não cadastrada no contrato." });

for (const [label, c, r] of results) {
  console.log(`${label.padEnd(22)} ${c}  esperado ${r.expected.expectedTotal ?? "-"}  diferença ${r.reconciliation.differenceAmount ?? "-"}  ${r.reconciliation.outcome ?? r.expected.status}`);
}
console.log(`\nDemo criada. Entre com ${EMAIL} / ${PASSWORD}`);
await closePool();
