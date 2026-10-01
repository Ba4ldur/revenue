import Link from "next/link";
import { getContract } from "@/application/contracts";
import { listContractDocuments, DOCUMENT_TYPES } from "@/application/documents";
import { listRules } from "@/application/rules";
import { contractCompetences, entityHistory } from "@/application/contract-overview";
import { can } from "@/application/context";
import { RULE_TYPE_LABELS, UNIT_LABELS } from "@/domain/contracts/rules";
import { requireOrg } from "@/lib/session";
import { ActionForm } from "@/components/forms";
import {
  Comp, DateBR, DateTime, Empty, Field, KeyValue, LinkButton, Money, Notice, PageHeader, Qty, Section, StatusBadge, Table, Td, Th, inputCls,
} from "@/components/ui";
import { amendmentAction, reprocessContractAction, runCalculationAction } from "../actions";
import { DirectUploadForm } from "@/components/direct-upload";
import { createUploadIntentAction, finalizeUploadAction } from "../../uploads/actions";

const DOC_LABELS: Record<string, string> = { CONTRACT: "Contrato", AMENDMENT: "Aditivo", PROPOSAL: "Proposta", PRICE_TABLE: "Tabela de preços", SLA: "SLA", OTHER: "Outro" };
const SOURCE_LABELS: Record<string, string> = { ORIGINAL: "Original", AMENDMENT: "Aditivo", CORRECTION: "Correção" };

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg();
  const { contract, versions } = await getContract(ctx, id);
  const [docs, rules, comps] = await Promise.all([listContractDocuments(ctx, id), listRules(ctx, id), contractCompetences(ctx, id)]);
  const history = await entityHistory(ctx, [id, ...versions.map((v) => v.id), ...docs.map((d) => d.id), ...rules.map((r) => r.id)]);
  const active = rules.filter((r) => r.status === "ACTIVE");
  const pending = rules.filter((r) => r.status === "PROPOSED" || r.status === "CONFIRMED").length;
  const openVersion = versions.find((v) => v.status === "ACTIVE" && v.validUntil === null);

  return (
    <>
      <PageHeader
        title={`Contrato ${contract.contractNumber}`}
        subtitle={<>{contract.customerName} · {contract.title}</>}
        crumbs={[{ href: "/contracts", label: "Contratos" }]}
        actions={<LinkButton href={`/contracts/${id}/rules`} variant="primary">Regras{pending ? ` (${pending} para revisar)` : ""}</LinkButton>}
      />
      <Section title="Resumo">
        <KeyValue items={[
          ["Cliente", <Link key="c" className="text-brand hover:underline" href={`/customers/${contract.customerId}`}>{contract.customerName}</Link>],
          ["Status", <StatusBadge key="s" status={contract.status} />],
          ["Vigência", <span key="v"><DateBR value={contract.startDate} /> – {contract.endDate ? <DateBR value={contract.endDate} /> : "indeterminado"}</span>],
          ["Versões", String(versions.length)],
          ["Regras ativas", String(active.length)],
          ["Documentos", String(docs.length)],
        ]} />
      </Section>

      <Section title="Versões contratuais" description="Cada competência usa a versão ativa que cobre o mês inteiro. Versões substituídas permanecem como histórico.">
        <Table>
          <thead><tr><Th>Versão</Th><Th>Vigência</Th><Th>Origem</Th><Th>Status</Th><Th>Regras ativas</Th></tr></thead>
          <tbody>{versions.map((v) => (
            <tr key={v.id}>
              <Td>v{v.versionNumber}</Td>
              <Td><DateBR value={v.validFrom} /> – {v.validUntil ? <DateBR value={v.validUntil} /> : "em aberto"}</Td>
              <Td>{SOURCE_LABELS[v.sourceType] ?? v.sourceType}</Td>
              <Td><StatusBadge status={v.status} /></Td>
              <Td>{active.filter((r) => r.contractVersionId === v.id).map((r) => (
                <div key={r.id} className="text-xs">{RULE_TYPE_LABELS[r.ruleType]}: {r.ruleType === "INCLUDED_QUANTITY" ? <Qty value={r.numericValue} unit={UNIT_LABELS[r.unit ?? ""]} /> : <Money value={r.numericValue} />}{r.unit && r.ruleType !== "INCLUDED_QUANTITY" ? `/${UNIT_LABELS[r.unit]}` : ""}</div>
              ))}</Td>
            </tr>
          ))}</tbody>
        </Table>
        {can(ctx, "contracts.write") && openVersion && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-brand">Registrar aditivo (nova versão)</summary>
            <div className="mt-3 max-w-xl">
              <ActionForm action={amendmentAction.bind(null, id)} submitLabel="Criar versão" confirmMessage={`A versão v${openVersion.versionNumber} será encerrada no dia anterior. Continuar?`}>
                <Field label="Vigência a partir de"><input name="validFrom" type="date" required className={inputCls} /></Field>
                <Field label="Observação"><input name="notes" className={inputCls} /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="carryRules" defaultChecked /> Copiar regras ativas como propostas (exigem nova confirmação)</label>
              </ActionForm>
            </div>
          </details>
        )}
      </Section>

      <Section title="Documentos" description="Arquivos privados; download por link temporário e auditado.">
        {docs.length === 0 ? <Empty title="Nenhum documento anexado">Anexe o PDF do contrato para extrair regras.</Empty> : (
          <Table>
            <thead><tr><Th>Arquivo</Th><Th>Tipo</Th><Th>Versão</Th><Th>Páginas</Th><Th>Texto</Th><Th>SHA-256</Th><Th>Enviado</Th></tr></thead>
            <tbody>{docs.map((d) => (
              <tr key={d.id}>
                <Td>{can(ctx, "documents.download") ? <a className="text-brand hover:underline" href={`/api/documents/${d.id}/download`} target="_blank" rel="noopener">{d.fileName}</a> : d.fileName}</Td>
                <Td>{DOC_LABELS[d.documentType]}</Td>
                <Td>{d.contractVersionId ? `v${versions.find((v) => v.id === d.contractVersionId)?.versionNumber}` : "—"}</Td>
                <Td right>{d.pageCount ?? "—"}</Td>
                <Td><StatusBadge status={d.textStatus} label={{ COMPLETED: "Extraído", NO_TEXT: "Sem texto (escaneado?)", FAILED: "Falhou", PENDING: "Pendente" }[d.textStatus]} /></Td>
                <Td mono>{d.sha256.slice(0, 12)}…</Td>
                <Td><DateTime value={d.uploadedAt} /></Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
        {can(ctx, "documents.write") && (
          <div className="mt-4 max-w-2xl">
            <DirectUploadForm kind="CONTRACT_DOCUMENT" extra={{ contractId: id }} submitLabel="Enviar PDF" accept="application/pdf,.pdf"
              createIntent={createUploadIntentAction} finalize={finalizeUploadAction}>
              <Field label="Tipo">
                <select name="documentType" className={inputCls}>{DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{DOC_LABELS[t]}</option>)}</select>
              </Field>
              <Field label="Versão">
                <select name="versionId" defaultValue={openVersion?.id ?? ""} className={inputCls}>
                  <option value="">Sem versão</option>
                  {versions.filter((v) => v.status !== "SUPERSEDED").map((v) => <option key={v.id} value={v.id}>v{v.versionNumber}</option>)}
                </select>
              </Field>
            </DirectUploadForm>
            <p className="mt-1 text-xs text-ink-3">PDF até 20 MB, enviado diretamente ao armazenamento privado e revalidado no servidor.</p>
          </div>
        )}
      </Section>

      <Section title="Receita esperada × faturamento por competência" description="Valores do cálculo corrente. Tentativas que exigem revisão aparecem destacadas.">
        {comps.length === 0 ? <Empty title="Nenhuma competência calculada">Importe operação e faturamento e calcule a competência.</Empty> : (
          <Table>
            <thead><tr><Th>Competência</Th><Th>Versão</Th><Th right>Esperado</Th><Th right>Faturado</Th><Th right>Diferença</Th><Th>Resultado</Th><Th>Motor</Th></tr></thead>
            <tbody>{comps.map((c) => {
              const failed = (c.latest_expected_status === "FAILED" && !c.expected_run_id) || c.latest_rec_status === "FAILED";
              const err = (c.latest_rec_status === "FAILED" ? c.latest_rec_error : c.latest_expected_error) as { message?: string } | null;
              return (
                <tr key={c.competence}>
                  <Td><Comp value={c.competence} /></Td>
                  <Td>{c.version_number ? `v${c.version_number}` : "—"}</Td>
                  <Td right><Money value={c.expected_total} /></Td>
                  <Td right><Money value={c.billed} /></Td>
                  <Td right><Money value={c.difference} /></Td>
                  <Td>
                    {c.finding_id ? <Link className="text-brand hover:underline" href={`/findings/${c.finding_id}`}><StatusBadge status={c.finding_status} /> ver divergência</Link>
                      : c.outcome === "NO_DIVERGENCE" ? <StatusBadge status="COMPLETED" label="Sem divergência" />
                      : c.outcome === "BELOW_MATERIALITY" ? <StatusBadge status="PENDING" label="Abaixo da materialidade" />
                      : c.outcome === "OVERBILLED_NOT_EVALUATED" ? <StatusBadge status="PENDING" label="Faturado acima (fora do MVP)" /> : null}
                    {failed && <div className="mt-1 text-xs text-warn">Última tentativa exige revisão: {err?.message ?? "erro técnico"}</div>}
                  </Td>
                  <Td mono>{c.expected_engine ?? "—"}</Td>
                </tr>
              );
            })}</tbody>
          </Table>
        )}
        {can(ctx, "calculations.run") && (
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <ActionForm action={runCalculationAction.bind(null, id)} submitLabel="Calcular competência" pendingLabel="Calculando…" inline>
              <Field label="Competência (MM/AAAA)"><input name="competence" required placeholder="09/2026" className={inputCls} /></Field>
            </ActionForm>
            <ActionForm action={reprocessContractAction.bind(null, id)} submitLabel="Reprocessar intervalo" pendingLabel="Reprocessando…" inline
              confirmMessage="Será criado um novo cálculo versionado para cada competência; os anteriores ficam preservados. Continuar?">
              <Field label="De"><input name="from" required placeholder="01/2026" className={`${inputCls} w-24`} /></Field>
              <Field label="Até"><input name="until" required placeholder="09/2026" className={`${inputCls} w-24`} /></Field>
              <Field label="Motivo"><input name="reason" required minLength={3} className={inputCls} /></Field>
            </ActionForm>
          </div>
        )}
      </Section>

      {history && (
        <Section title="Histórico (auditoria)">
          {history.length === 0 ? <Empty title="Sem registros" /> : (
            <Table>
              <thead><tr><Th>Quando</Th><Th>Ação</Th><Th>Entidade</Th><Th>Ator</Th></tr></thead>
              <tbody>{history.map((h) => (
                <tr key={h.id}><Td><DateTime value={h.created_at} /></Td><Td mono>{h.intent ?? h.action}</Td><Td>{h.entity_type}</Td><Td>{h.actor_email ?? h.actor_type}</Td></tr>
              ))}</tbody>
            </Table>
          )}
        </Section>
      )}
      {comps.some((c) => c.latest_expected_status === "FAILED") && (
        <Notice tone="warn">Há competências cuja última tentativa de cálculo exige revisão; o resultado corrente (se houver) foi preservado.</Notice>
      )}
    </>
  );
}
