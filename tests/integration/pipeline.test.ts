import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool } from "@/infrastructure/db/client";
import type { OrgContext, Role } from "@/application/context";
import { createCustomer } from "@/application/customers";
import { createAmendment, createContract } from "@/application/contracts";
import { uploadContractDocument } from "@/application/documents";
import { activateRule, confirmRule, createManualRule, extractRulesFromDocument, listRules } from "@/application/rules";
import { decideEntityMatch, getImport, processImport, uploadImport } from "@/application/imports/imports";
import { DEFAULT_ENGINES, runRevenueAssurance, type EngineSet } from "@/application/calculations";
import { classifyFinding, getFindingDetail } from "@/application/findings";
import { createAndRunReprocessing } from "@/application/reprocessing";
import { setMaterialityPolicy } from "@/application/organizations";
import { DeterministicTestExtractionProvider } from "@/ai/test-provider";
import type { ExpectedRevenueResult } from "@/domain/revenue/expected-revenue-engine";
import { adminSql, asSystem, createOrg, expectDbError, makeCnpj, type OrgFixture } from "./helpers";
import { CANONICAL_CONTRACT_PAGES, makeTextPdf } from "../support/pdf";

const provider = new DeterministicTestExtractionProvider();
let org: OrgFixture;
const ctx = (role: Role = "ADMIN"): OrgContext => ({ userId: org.members[role], orgId: org.orgId, role, orgName: "Acme" });
const csv = (s: string) => ({ name: "dados.csv", type: "text/csv", bytes: new TextEncoder().encode(s) });

const OP_MAPPING = { cnpj: "CNPJ", customer_name: "Cliente", competence: "Competência", quantity: "Horas", description: "Descrição" };
const OP_OPTIONS = { numberFormat: "BR", competence: { mode: "COLUMN" }, defaultUnit: "HOUR", defaultEventType: "SUPORTE_TECNICO" };
const BILL_MAPPING = { cnpj: "CNPJ", customer_name: "Cliente", competence: "Competência", amount: "Valor", date: "Emissão", document_number: "NF" };
const BILL_OPTIONS = { numberFormat: "BR", competence: { mode: "COLUMN" } };

interface Scenario {
  customerId: string;
  cnpj: string;
  contractId: string;
  contractNumber: string;
  versionId: string;
  documentId: string;
  rules: Record<string, string>;
}

let seq = 0;
async function setupContract(name: string, pages = CANONICAL_CONTRACT_PAGES): Promise<Scenario> {
  const n = ++seq;
  const cnpj = makeCnpj(700000 + n + Math.floor(Math.random() * 100000));
  const customerId = await createCustomer(ctx(), { legalName: `${name} S.A.`, cnpj });
  const contractNumber = `00921-${n}-${Date.now() % 100000}`;
  const { contractId, versionId } = await createContract(ctx("COMMERCIAL"), { customerId, contractNumber, title: "Suporte", startDate: "2026-01-01" });
  const { documentId } = await uploadContractDocument(ctx("COMMERCIAL"), {
    contractId, contractVersionId: versionId, documentType: "CONTRACT",
    file: { name: "Contrato.pdf", type: "application/pdf", bytes: makeTextPdf(pages) },
  });
  return { customerId, cnpj, contractId, contractNumber, versionId, documentId, rules: {} };
}

async function extractConfirmActivate(s: Scenario): Promise<void> {
  const r = await extractRulesFromDocument(ctx("COMMERCIAL"), s.documentId, provider);
  expect(r.proposals).toBe(3);
  for (const rule of await listRules(ctx(), s.contractId)) {
    expect(rule.status).toBe("PROPOSED");
    expect(rule.sourceVerified).toBe(true);
    await confirmRule(ctx("ADMIN"), rule.id);
    await activateRule(ctx("ADMIN"), rule.id);
    s.rules[rule.ruleType] = rule.id;
  }
}

async function importOperational(s: Scenario, body: string) {
  const up = await uploadImport(ctx("FINANCE"), { type: "OPERATIONAL", file: csv(body) });
  if (up.status === "DUPLICATE") return up;
  const res = await processImport(ctx("FINANCE"), up.importId, OP_MAPPING, OP_OPTIONS);
  return { ...up, status: res.status };
}

async function importBilling(body: string) {
  const up = await uploadImport(ctx("FINANCE"), { type: "BILLING", file: csv(body) });
  if (up.status === "DUPLICATE") return up;
  const res = await processImport(ctx("FINANCE"), up.importId, BILL_MAPPING, BILL_OPTIONS);
  return { ...up, status: res.status };
}

const count = async (table: string, where: string, params: unknown[]) =>
  (await adminSql().unsafe(`select count(*)::int as n from app.${table} where ${where}`, params as never[]))[0]!.n as number;

beforeAll(async () => {
  org = await createOrg("Acme");
});
afterAll(async () => {
  await closePool();
});

describe("Cenário canônico ponta a ponta (SUCCESS_CRITERIA)", () => {
  let s: Scenario;
  let findingId: string;

  it("contrato PDF → extração IA → revisão humana → regras ativas", async () => {
    s = await setupContract("Indústria ABC");
    const [doc] = await adminSql()`select storage_path, text_status, page_count from app.contract_documents where id = ${s.documentId}`;
    expect(doc).toMatchObject({ text_status: "COMPLETED", page_count: 2 });
    expect(doc!.storage_path).toMatch(new RegExp(`^${org.orgId}/[0-9a-f-]{36}\\.pdf$`));
    await extractConfirmActivate(s);
    const rules = await listRules(ctx(), s.contractId);
    expect(rules.map((r) => [r.ruleType, r.numericValue, r.unit, r.status, r.sourcePage]).sort()).toEqual([
      ["EXCESS_UNIT_PRICE", "280.000000", "HOUR", "ACTIVE", 2],
      ["FIXED_MONTHLY_FEE", "18000.000000", null, "ACTIVE", 2],
      ["INCLUDED_QUANTITY", "40.000000", "HOUR", "ACTIVE", 2],
    ]);
  });

  it("extração repetida é idempotente (não duplica propostas)", async () => {
    const again = await extractRulesFromDocument(ctx("ADMIN"), s.documentId, provider);
    expect(again.reused).toBe(true);
    expect(await count("contract_rules", "contract_id = $1", [s.contractId])).toBe(3);
  });

  it("imports operacional e de faturamento geram eventos com competência 2026-09-01 (TESTE 16)", async () => {
    const op = await importOperational(s, `CNPJ;Cliente;Competência;Horas;Descrição\n${s.cnpj};Indústria ABC;09/2026;30;Chamados\n${s.cnpj};Indústria ABC;09/2026;27;Visitas\n`);
    expect(op.status).toBe("COMPLETED");
    const bill = await importBilling(`CNPJ;Cliente;Competência;Valor;Emissão;NF\n${s.cnpj};Indústria ABC;09/2026;18.000,00;05/10/2026;1234\n`);
    expect(bill.status).toBe("COMPLETED");
    const ev = await adminSql()`select competence, quantity, entity_match_confidence from app.operational_events where customer_id = ${s.customerId} order by quantity`;
    expect(ev).toEqual([
      { competence: "2026-09-01", quantity: "27.000000", entity_match_confidence: "1.0000" },
      { competence: "2026-09-01", quantity: "30.000000", entity_match_confidence: "1.0000" },
    ]);
  });

  it("motor gera Expected R$ 22.760, reconciliação e finding OPEN de R$ 4.760 com evidências", async () => {
    const r = await runRevenueAssurance(ctx("FINANCE"), s.contractId, "2026-09-01");
    expect(r.expected).toMatchObject({ status: "CREATED", expectedTotal: "22760.00" });
    expect(r.reconciliation).toMatchObject({ status: "CREATED", outcome: "FINDING", differenceAmount: "4760.00" });
    findingId = r.findingId!;
    const d = await getFindingDetail(ctx("EXECUTIVE"), findingId);
    expect(d.finding).toMatchObject({
      finding_type: "CONSUMO_EXCEDENTE_NAO_FATURADO", status: "OPEN", expected_amount: "22760.00", billed_amount: "18000.00",
      difference_amount: "4760.00", evidence_completeness: "1.0000", extraction_confidence: "0.9000", entity_match_confidence: "1.0000",
    });
    expect(d.finding.explanation).toMatch(/^Possível receita não faturada: R\$ 4\.760,00/);
    expect(d.runs.map((x) => `${x.calculation_type}@${x.engine_version}:${x.status}`).sort()).toEqual([
      "EXPECTED_REVENUE@1.0.0:COMPLETED", "RECONCILIATION@1.0.0:COMPLETED",
    ]);
    expect(d.components.map((c) => [c.component_type, c.amount])).toEqual([["BASE", "18000.00"], ["EXCESS", "4760.00"]]);
    const types = d.evidence.map((e) => e.evidence_type);
    for (const t of ["CONTRACT_DOCUMENT", "CONTRACT_RULE", "OPERATIONAL_EVENT", "CALCULATION_COMPONENT", "EXPECTED_REVENUE", "BILLING_EVENT", "CALCULATION_RUN"]) {
      expect(types).toContain(t);
    }
    const clause = d.evidence.find((e) => e.evidence_type === "CONTRACT_RULE" && /Franquia|Quantidade/.test(e.description));
    expect(clause).toMatchObject({ page_number: 2, text_excerpt: "incluídas 40 horas mensais" });
    expect(d.evidence.filter((e) => e.evidence_type === "OPERATIONAL_EVENT").every((e) => e.source_import_row_id)).toBe(true);
  });

  it("TESTE 12 — reexecução idêntica é no-op (mesmos runs, nenhum finding novo)", async () => {
    const runsBefore = await count("calculation_runs", "contract_id = $1", [s.contractId]);
    const r = await runRevenueAssurance(ctx("FINANCE"), s.contractId, "2026-09-01");
    expect(r.expected.status).toBe("REUSED");
    expect(r.reconciliation.status).toBe("REUSED");
    expect(r.findingId).toBe(findingId);
    expect(await count("calculation_runs", "contract_id = $1", [s.contractId])).toBe(runsBefore);
    expect(await count("findings", "contract_id = $1", [s.contractId])).toBe(1);
  });

  it("TESTE 11 — mesmo CSV duas vezes não duplica eventos; arquivo diferente com linhas repetidas também não", async () => {
    const before = await count("operational_events", "customer_id = $1", [s.customerId]);
    const dup = await importOperational(s, `CNPJ;Cliente;Competência;Horas;Descrição\n${s.cnpj};Indústria ABC;09/2026;30;Chamados\n${s.cnpj};Indústria ABC;09/2026;27;Visitas\n`);
    expect(dup.status).toBe("DUPLICATE");
    const overlap = await importOperational(s, `Cliente;CNPJ;Competência;Horas;Descrição\nIndústria ABC;${s.cnpj};09/2026;30;Chamados\n`);
    expect(overlap.status).toBe("COMPLETED");
    const detail = await getImport(ctx("FINANCE"), overlap.importId);
    expect(detail.import).toMatchObject({ duplicate_rows: 1, imported_rows: 0 });
    expect(await count("operational_events", "customer_id = $1", [s.customerId])).toBe(before);
  });

  it("TESTE 17 — mesma NF reimportada em outro arquivo não duplica faturamento", async () => {
    const before = await count("billing_events", "customer_id = $1", [s.customerId]);
    const again = await importBilling(`NF;CNPJ;Cliente;Competência;Valor;Emissão\n1234;${s.cnpj};Indústria ABC;09/2026;18.000,00;05/10/2026\n`);
    expect(again.status).toBe("COMPLETED");
    expect(await count("billing_events", "customer_id = $1", [s.customerId])).toBe(before);
    const r = await runRevenueAssurance(ctx("FINANCE"), s.contractId, "2026-09-01");
    expect(r.reconciliation.status).toBe("REUSED");
  });

  it("permissões: EXECUTIVE não calcula; FINANCE não confirma regras; AUDITOR não classifica", async () => {
    await expect(runRevenueAssurance(ctx("EXECUTIVE"), s.contractId, "2026-09-01")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(confirmRule(ctx("FINANCE"), s.rules.FIXED_MONTHLY_FEE!)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(classifyFinding(ctx("AUDITOR"), findingId, { action: "CONFIRM" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("TESTE 9 — classificação humana gera FindingAction e AuditLog; motor nunca classifica", async () => {
    await classifyFinding(ctx("AUDITOR"), findingId, { action: "START_REVIEW" });
    await expect(classifyFinding(ctx("FINANCE"), findingId, { action: "MARK_FALSE_POSITIVE" })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await classifyFinding(ctx("FINANCE"), findingId, { action: "MARK_FALSE_POSITIVE", reason: "Horas de garantia não faturáveis" });
    const actions = await adminSql()`select action_type, previous_status, new_status, performed_by from app.finding_actions where finding_id = ${findingId} order by performed_at`;
    expect(actions).toEqual([
      { action_type: "START_REVIEW", previous_status: "OPEN", new_status: "UNDER_REVIEW", performed_by: org.members.AUDITOR },
      { action_type: "MARK_FALSE_POSITIVE", previous_status: "UNDER_REVIEW", new_status: "FALSE_POSITIVE", performed_by: org.members.FINANCE },
    ]);
    const audits = await adminSql()`select action, actor_user_id, metadata->>'intent' as intent from app.audit_logs
                                    where entity_id = ${findingId} and action in ('findings.update', 'finding_actions.insert') order by created_at`;
    expect(audits.some((a) => a.intent === "finding.mark_false_positive" && a.actor_user_id === org.members.FINANCE)).toBe(true);
    const [f] = await adminSql()`select status, resolved_at from app.findings where id = ${findingId}`;
    expect(f!.status).toBe("FALSE_POSITIVE");
    expect(f!.resolved_at).not.toBeNull();
    // status não muda fora de FindingAction, nem pelo service_role
    await expectDbError(asSystem(null, (tx) => tx`update app.findings set status = 'CONFIRMED' where id = ${findingId}`), /FindingAction/);
    await expectDbError(asSystem(null, (tx) => tx`update app.findings set difference_amount = 1 where id = ${findingId}`), /IMMUTABLE_FIELD/);
    // reabrir exige motivo e volta para revisão
    await classifyFinding(ctx("FINANCE"), findingId, { action: "REOPEN", reason: "Revisar com o comercial" });
    await classifyFinding(ctx("FINANCE"), findingId, { action: "CONFIRM" });
    await classifyFinding(ctx("FINANCE"), findingId, { action: "MARK_RECOVERED", recoveredAmount: "4.760,00" });
    const [g] = await adminSql()`select status, recovered_amount from app.findings where id = ${findingId}`;
    expect(g).toEqual({ status: "RECOVERED", recovered_amount: "4760.00" });
  });
});

describe("Cenários adicionais", () => {
  it("TESTE 4 — contrato ativo sem faturamento ⇒ CLIENTE_ATIVO_SEM_FATURAMENTO", async () => {
    const s = await setupContract("Cliente Sem NF");
    await extractConfirmActivate(s);
    await importOperational(s, `CNPJ;Cliente;Competência;Horas;Descrição\n${s.cnpj};Cliente Sem NF;08/2026;10;Suporte\n`);
    const r = await runRevenueAssurance(ctx("FINANCE"), s.contractId, "2026-08-01");
    const [f] = await adminSql()`select finding_type, expected_amount, billed_amount, difference_amount from app.findings where id = ${r.findingId}`;
    expect(f).toEqual({ finding_type: "CLIENTE_ATIVO_SEM_FATURAMENTO", expected_amount: "18000.00", billed_amount: "0.00", difference_amount: "18000.00" });
    const ev = await adminSql()`select evidence_type from app.finding_evidence where finding_id = ${r.findingId}`;
    expect(ev.map((e) => e.evidence_type)).toContain("NO_BILLING_FOUND");
  });

  it("TESTE 13 — regra corrigida (R$ 180 → R$ 280) cria novo CalculationRun e preserva histórico", async () => {
    const pages = [["CLÁUSULA 4 - DO PREÇO", "O CONTRATANTE pagará mensalidade fixa de R$ 18.000,00 (dezoito mil reais).",
      "Estão incluídas 40 horas mensais de suporte técnico.", "Cada hora adicional será faturada a R$ 180,00 (cento e oitenta reais).",
      "Termo de retificação: cada hora adicional será faturada a R$ 280,00."]];
    const s = await setupContract("Cliente Correção", pages);
    await extractConfirmActivate(s);
    const [price] = await adminSql()`select numeric_value from app.contract_rules where id = ${s.rules.EXCESS_UNIT_PRICE}`;
    expect(price!.numeric_value).toBe("180.000000");
    await importOperational(s, `CNPJ;Cliente;Competência;Horas;Descrição\n${s.cnpj};Cliente Correção;09/2026;57;Suporte\n`);
    await importBilling(`CNPJ;Cliente;Competência;Valor;Emissão;NF\n${s.cnpj};Cliente Correção;09/2026;18.000,00;05/10/2026;C-${s.cnpj.slice(0, 6)}\n`);
    const first = await runRevenueAssurance(ctx("FINANCE"), s.contractId, "2026-09-01");
    const [f1] = await adminSql()`select difference_amount from app.findings where id = ${first.findingId}`;
    expect(f1!.difference_amount).toBe("3060.00");

    const newRule = await createManualRule(ctx("ADMIN"), {
      contractVersionId: s.versionId, sourceDocumentId: s.documentId, ruleType: "EXCESS_UNIT_PRICE", value: "280,00", unit: "HOUR",
      validFrom: "2026-01-01", sourceText: "cada hora adicional será faturada a R$ 280,00",
    });
    await confirmRule(ctx("ADMIN"), newRule);
    const { affectedCompetences } = await activateRule(ctx("ADMIN"), newRule, s.rules.EXCESS_UNIT_PRICE);
    expect(affectedCompetences).toEqual(["2026-09-01"]);
    const job = await createAndRunReprocessing(ctx("FINANCE"), {
      reason: "Correção do preço da hora excedente", triggerEntityType: "contract_rules", triggerEntityId: newRule,
      contractIds: [s.contractId], affectedFrom: "2026-09-01", affectedUntil: "2026-09-01",
    });
    expect(job.items).toHaveLength(1);
    expect(job.items[0]).toMatchObject({ before: { difference: "3060.00" }, after: { difference: "4760.00" }, changed: true });

    const runs = await adminSql()`select calculation_type, status, supersedes_run_id is not null as supersedes, reprocessing_job_id is not null as by_job
                                  from app.calculation_runs where contract_id = ${s.contractId} order by created_at, calculation_type`;
    expect(runs).toEqual([
      { calculation_type: "EXPECTED_REVENUE", status: "SUPERSEDED", supersedes: false, by_job: false },
      { calculation_type: "RECONCILIATION", status: "SUPERSEDED", supersedes: false, by_job: false },
      { calculation_type: "EXPECTED_REVENUE", status: "COMPLETED", supersedes: true, by_job: true },
      { calculation_type: "RECONCILIATION", status: "COMPLETED", supersedes: true, by_job: true },
    ]);
    const [oldRule] = await adminSql()`select status, superseded_by_rule_id from app.contract_rules where id = ${s.rules.EXCESS_UNIT_PRICE}`;
    expect(oldRule).toEqual({ status: "SUPERSEDED", superseded_by_rule_id: newRule });
    const [newF] = await adminSql()`select difference_amount, previous_finding_id, status from app.findings where id = ${job.items[0]!.after.finding_id}`;
    expect(newF).toEqual({ difference_amount: "4760.00", previous_finding_id: first.findingId, status: "OPEN" });
    const [oldF] = await adminSql()`select difference_amount from app.findings where id = ${first.findingId}`;
    expect(oldF!.difference_amount).toBe("3060.00");
    // finding de execução substituída não pode ser classificado (somente anotado)
    await expect(classifyFinding(ctx("FINANCE"), first.findingId!, { action: "CONFIRM" })).rejects.toMatchObject({ code: "FINDING_NOT_CURRENT" });
  });

  it("TESTE 7 — nova versão do motor reprocessa sem alterar a versão do finding histórico", async () => {
    const s = await setupContract("Cliente Versão");
    await extractConfirmActivate(s);
    await importOperational(s, `CNPJ;Cliente;Competência;Horas;Descrição\n${s.cnpj};Cliente Versão;09/2026;50;Suporte\n`);
    const r1 = await runRevenueAssurance(ctx("FINANCE"), s.contractId, "2026-09-01");
    await adminSql()`insert into app.engine_registry (engine_name, engine_version, description, change_summary, calculation_breaking_change)
                     values ('expected_revenue_engine', '1.1.0', 'teste', 'teste de versionamento', true) on conflict do nothing`;
    const v110: EngineSet = { ...DEFAULT_ENGINES, expected: { ...DEFAULT_ENGINES.expected, version: "1.1.0" } };
    const r2 = await runRevenueAssurance(ctx("FINANCE"), s.contractId, "2026-09-01", { engines: v110 });
    expect(r2.expected.status).toBe("CREATED");
    const [old] = await adminSql()`select r.engine_version, r.status from app.findings f join app.calculation_runs r on r.id = f.calculation_run_id
                                   join app.calculation_runs p on p.id = r.parent_run_id where f.id = ${r1.findingId}`;
    expect(old!.status).toBe("SUPERSEDED");
    const [oldParent] = await adminSql()`select p.engine_version from app.findings f join app.calculation_runs r on r.id = f.calculation_run_id
                                         join app.calculation_runs p on p.id = r.parent_run_id where f.id = ${r1.findingId}`;
    expect(oldParent!.engine_version).toBe("1.0.0");
    const [cur] = await adminSql()`select engine_version from app.calculation_runs where id = ${r2.expected.runId}`;
    expect(cur!.engine_version).toBe("1.1.0");
  });

  it("TESTE 15 — invariante violada: run FAILED, nada financeiro publicado", async () => {
    const s = await setupContract("Cliente Invariante");
    await extractConfirmActivate(s);
    const broken: EngineSet = {
      ...DEFAULT_ENGINES,
      expected: {
        ...DEFAULT_ENGINES.expected,
        calculate: (i) => {
          const out = DEFAULT_ENGINES.expected.calculate(i);
          if (out.status !== "CALCULATED") return out;
          const r: ExpectedRevenueResult = { ...out.result, components: out.result.components.map((c) => (c.componentType === "BASE" ? { ...c, amount: "17999.00" } : c)) };
          return { status: "CALCULATED", result: r };
        },
      },
    };
    await expect(runRevenueAssurance(ctx("FINANCE"), s.contractId, "2026-09-01", { engines: broken })).rejects.toMatchObject({ code: "CALCULATION_FAILED" });
    const runs = await adminSql()`select status, error_details->>'code' as code from app.calculation_runs where contract_id = ${s.contractId}`;
    expect(runs).toEqual([{ status: "FAILED", code: "INVARIANT_VIOLATION" }]);
    expect(await count("expected_revenue_events", "contract_id = $1", [s.contractId])).toBe(0);
    expect(await count("findings", "contract_id = $1", [s.contractId])).toBe(0);
  });

  it("TESTE 8 — nome aproximado gera match PROPOSED; eventos só após confirmação humana", async () => {
    const s = await setupContract("Metalúrgica Horizonte");
    await extractConfirmActivate(s);
    const up = await uploadImport(ctx("FINANCE"), { type: "BILLING", file: csv(`Cliente;Competência;Valor;Emissão;NF\nMetalurgica Horizont;09/2026;18.000,00;05/10/2026;H-${s.cnpj.slice(0, 6)}\n`) });
    const res = await processImport(ctx("FINANCE"), up.importId, { customer_name: "Cliente", competence: "Competência", amount: "Valor", date: "Emissão", document_number: "NF" }, BILL_OPTIONS);
    expect(res.status).toBe("NEEDS_REVIEW");
    const detail = await getImport(ctx("FINANCE"), up.importId);
    expect(detail.pendingMatches).toHaveLength(1);
    expect(detail.pendingMatches[0]).toMatchObject({ status: "PROPOSED", method: "FUZZY", candidate_customer_id: s.customerId });
    expect(await count("billing_events", "source_import_id = $1", [up.importId])).toBe(0);
    await decideEntityMatch(ctx("FINANCE"), detail.pendingMatches[0]!.id, { action: "CONFIRM" });
    expect(await count("billing_events", "source_import_id = $1", [up.importId])).toBe(1);
    const [imp] = await adminSql()`select status from app.imports where id = ${up.importId}`;
    expect(imp!.status).toBe("COMPLETED");
  });

  it("TESTE 10 — mudança de materialidade reprocessa só a reconciliação e preserva histórico", async () => {
    const s = await setupContract("Cliente Materialidade");
    await extractConfirmActivate(s);
    // 18.000 esperado, 17.600 faturado: R$ 400 (2,2%) ⇒ abaixo de 500 AND 1%
    await importBilling(`CNPJ;Cliente;Competência;Valor;Emissão;NF\n${s.cnpj};Cliente Materialidade;09/2026;17.600,00;05/10/2026;M-${s.cnpj.slice(0, 6)}\n`);
    const r1 = await runRevenueAssurance(ctx("FINANCE"), s.contractId, "2026-09-01");
    expect(r1.reconciliation.outcome).toBe("BELOW_MATERIALITY");
    expect(r1.findingId).toBeNull();
    await setMaterialityPolicy(ctx("ADMIN"), { mode: "COMBINED", absoluteThreshold: "500", percentagePoints: "1", combinationOperator: "OR" });
    const r2 = await runRevenueAssurance(ctx("FINANCE"), s.contractId, "2026-09-01");
    expect(r2.expected.status).toBe("REUSED");
    expect(r2.reconciliation).toMatchObject({ status: "CREATED", outcome: "FINDING", differenceAmount: "400.00" });
    const policies = await adminSql()`select version, status from app.materiality_policies where organization_id = ${org.orgId} order by version`;
    expect(policies.map((p) => p.status)).toEqual(["SUPERSEDED", "ACTIVE"]);
    await setMaterialityPolicy(ctx("ADMIN"), { mode: "COMBINED", absoluteThreshold: "500", percentagePoints: "1", combinationOperator: "AND" });
  });

  it("TESTE 14 — aditivo: maio usa versão 1, agosto usa versão 2", async () => {
    const s = await setupContract("Cliente Aditivo");
    await extractConfirmActivate(s);
    const v2 = await createAmendment(ctx("COMMERCIAL"), s.contractId, { validFrom: "2026-07-01", notes: "Reajuste", carryRules: true });
    const carried = await adminSql()`select id, rule_type, status from app.contract_rules where contract_version_id = ${v2}`;
    expect(carried.every((r) => r.status === "PROPOSED")).toBe(true);
    for (const r of carried) {
      if (r.rule_type === "FIXED_MONTHLY_FEE") continue;
      await confirmRule(ctx("ADMIN"), r.id);
      await activateRule(ctx("ADMIN"), r.id);
    }
    const pdf2 = makeTextPdf([["TERMO ADITIVO Nº 1", "A partir de 01/07/2026 a mensalidade fixa de R$ 20.000,00 (vinte mil reais)."]]);
    const { documentId } = await uploadContractDocument(ctx("COMMERCIAL"), { contractId: s.contractId, contractVersionId: v2, documentType: "AMENDMENT", file: { name: "Aditivo.pdf", type: "application/pdf", bytes: pdf2 } });
    const fee = await createManualRule(ctx("ADMIN"), { contractVersionId: v2, sourceDocumentId: documentId, ruleType: "FIXED_MONTHLY_FEE", value: "20.000,00", validFrom: "2026-07-01", sourceText: "mensalidade fixa de R$ 20.000,00" });
    await confirmRule(ctx("ADMIN"), fee);
    await activateRule(ctx("ADMIN"), fee);
    const may = await runRevenueAssurance(ctx("FINANCE"), s.contractId, "2026-05-01");
    const aug = await runRevenueAssurance(ctx("FINANCE"), s.contractId, "2026-08-01");
    expect(may.expected.expectedTotal).toBe("18000.00");
    expect(aug.expected.expectedTotal).toBe("20000.00");
    const [v] = await adminSql()`select e.contract_version_id from app.expected_revenue_events e where e.calculation_run_id = ${aug.expected.runId}`;
    expect(v!.contract_version_id).toBe(v2);
  });
});
