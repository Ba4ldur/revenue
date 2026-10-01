import Link from "next/link";
import { getFindingDetail } from "@/application/findings";
import { ACTION_LABELS, FINDING_STATUS_LABELS } from "@/domain/findings/labels";
import { FINDING_TYPE_LABELS, type FindingType } from "@/domain/reconciliation/reconciliation-engine";
import { formatCompetence } from "@/domain/competence";
import { formatCnpj } from "@/domain/cnpj";
import { formatPercentFraction } from "@/domain/money/decimal";
import { UNIT_LABELS } from "@/domain/contracts/rules";
import { requireOrg } from "@/lib/session";
import { ActionForm } from "@/components/forms";
import { Badge, Comp, DateBR, DateTime, Empty, Field, KeyValue, Money, Notice, PageHeader, Qty, Section, StatusBadge, Table, Td, Th, UnitPrice, inputCls } from "@/components/ui";
import { classifyAction } from "../actions";

const NEEDS_REASON = new Set(["JUSTIFY", "MARK_FALSE_POSITIVE", "DISCARD", "REOPEN"]);
const ACTION_HELP: Record<string, string> = {
  START_REVIEW: "Indica que a investigação começou.",
  CONFIRM: "A divergência é real e requer ação (cobrança, correção).",
  JUSTIFY: "Existe diferença matemática, mas com justificativa comercial/contratual válida.",
  MARK_FALSE_POSITIVE: "O mecanismo detectou incorretamente uma divergência (dados ou regra errados).",
  DISCARD: "Descartada por decisão operacional documentada.",
  MARK_RECOVERED: "O valor foi recuperado posteriormente.",
  REOPEN: "Volta para revisão.",
  NOTE: "Anotação sem mudança de status.",
};

export default async function FindingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string }> }) {
  const { id } = await params;
  const { ok } = await searchParams;
  const ctx = await requireOrg();
  const d = await getFindingDetail(ctx, id);
  const f = d.finding;
  const ev = (t: string) => d.evidence.filter((e) => e.evidence_type === t);
  const expRun = d.runs.find((r) => r.calculation_type === "EXPECTED_REVENUE");
  const recRun = d.runs.find((r) => r.calculation_type === "RECONCILIATION");
  const mat = (recRun?.result_summary as { materiality?: Record<string, unknown> } | undefined)?.materiality;

  return (
    <>
      <PageHeader
        title={FINDING_TYPE_LABELS[f.finding_type as FindingType] ?? f.finding_type}
        subtitle={<>{f.customer_name} · contrato {f.contract_number} · competência {formatCompetence(f.competence)}</>}
        crumbs={[{ href: "/findings", label: "Divergências" }]}
        actions={<StatusBadge status={f.status} />}
      />
      {ok && ACTION_LABELS[ok] && <Notice tone="good">{ACTION_LABELS[ok]} registrado por você. Status atual: {FINDING_STATUS_LABELS[f.status]}.</Notice>}
      {!d.isCurrent && (
        <Notice tone="warn">
          Esta divergência pertence a um cálculo substituído (reprocessamento). Está preservada como histórico e não pode ser classificada.
          {d.successor && <> <Link className="underline" href={`/findings/${d.successor.id}`}>Ver resultado atual</Link></>}
        </Notice>
      )}
      {d.staleWarning && <Notice tone="warn">Um recálculo posterior desta competência exige revisão: {d.staleWarning}. Este resultado pode estar desatualizado.</Notice>}
      {d.previous && (
        <Notice>Recalculada a partir de uma divergência anterior (<Link className="underline" href={`/findings/${d.previous.id}`}>ver</Link>) que estava como <strong>{FINDING_STATUS_LABELS[d.previous.status]}</strong> com diferença <Money value={d.previous.difference_amount} />. A classificação anterior não é copiada automaticamente.</Notice>
      )}

      <Section title="Resumo e impacto">
        <p className="mb-4 text-sm">{f.explanation}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-md border border-line p-3"><p className="text-xs text-ink-3">Esperado (contrato + execução)</p><p className="text-lg font-semibold"><Money value={f.expected_amount} /></p></div>
          <div className="rounded-md border border-line p-3"><p className="text-xs text-ink-3">Faturado</p><p className="text-lg font-semibold"><Money value={f.billed_amount} /></p></div>
          <div className="rounded-md border border-warn/40 bg-warn-soft p-3"><p className="text-xs text-warn">Possível receita não faturada</p><p className="text-lg font-semibold text-warn"><Money value={f.difference_amount} /></p></div>
        </div>
        <div className="mt-4">
          <KeyValue items={[
            ["Severidade", f.severity],
            ["Completude da evidência", f.evidence_completeness ?? "—"],
            ["Confiança de extração (IA)", f.extraction_confidence ?? "regras manuais"],
            ["Confiança de vínculo de cliente", f.entity_match_confidence ?? "—"],
            ["Detectada em", <DateTime key="d" value={f.detected_at} />],
            ["Recuperado", f.recovered_amount ? <Money key="r" value={f.recovered_amount} /> : "—"],
          ]} />
          {mat && <p className="mt-3 text-xs text-ink-3">Materialidade v{String(mat.policy_version)} ({String(mat.mode)}{mat.operator ? ` ${String(mat.operator)}` : ""}): limite absoluto {mat.absolute_threshold ? String(mat.absolute_threshold) : "—"} {mat.absolute_hit === null ? "" : mat.absolute_hit ? "(atingido)" : "(não atingido)"}; percentual {mat.percentage_threshold ? `${formatPercentFraction(String(mat.percentage_threshold))}` : "—"} {mat.percentage_hit === null ? "" : mat.percentage_hit ? "(atingido)" : "(não atingido)"}; razão {String(mat.ratio ?? "—")}.</p>}
        </div>
      </Section>

      <Section title="Contrato e regras aplicadas">
        <KeyValue items={[
          ["Cliente", <span key="c">{f.customer_name} <span className="font-mono text-xs">{formatCnpj(f.customer_cnpj)}</span></span>],
          ["Contrato", <Link key="k" className="text-brand hover:underline" href={`/contracts/${f.contract_id}`}>{f.contract_number} — {f.contract_title}</Link>],
          ["Versão vigente na competência", <span key="v">v{f.version_number} (<DateBR value={f.version_valid_from} /> – {f.version_valid_until ? <DateBR value={f.version_valid_until} /> : "em aberto"})</span>],
        ]} />
        <div className="mt-4 space-y-2">
          {ev("CONTRACT_DOCUMENT").map((e) => (
            <p key={e.id} className="text-sm">📄 <a className="text-brand hover:underline" href={`/api/documents/${e.source_document_id}/download`} target="_blank" rel="noopener">{e.description.replace("Documento: ", "")}</a></p>
          ))}
          {ev("CONTRACT_RULE").map((e) => (
            <div key={e.id} className="rounded-md border border-line p-3 text-sm">
              <p className="font-medium">{e.description}</p>
              <blockquote className="mt-1 border-l-2 border-brand/40 pl-2 text-xs italic text-ink-2">Página {e.page_number}: “{e.text_excerpt}”</blockquote>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Execução (eventos operacionais)">
        {ev("OPERATIONAL_EVENT").length === 0 ? <Empty title="Nenhum evento operacional usado no cálculo" /> : (
          <ul className="space-y-1 text-sm">{ev("OPERATIONAL_EVENT").map((e) => (
            <li key={e.id}>{e.description} {e.source_import_id && <Link className="text-xs text-brand hover:underline" href={`/imports/${e.source_import_id}`}>(import · linha de origem)</Link>}</li>
          ))}</ul>
        )}
      </Section>

      <Section title="Receita esperada — memória de cálculo" description={`Motor ${expRun?.engine_name} ${expRun?.engine_version} · ROUND_HALF_UP, 2 casas, só no valor de cada componente`}>
        <Table>
          <thead><tr><Th>Componente</Th><Th right>Quantidade</Th><Th right>Preço unitário</Th><Th>Fórmula</Th><Th right>Valor</Th></tr></thead>
          <tbody>
            {d.components.map((c) => (
              <tr key={c.id}>
                <Td>{c.description}</Td>
                <Td right>{c.quantity ? <Qty value={c.quantity} unit={UNIT_LABELS[c.unit] ?? c.unit} /> : "—"}</Td>
                <Td right><UnitPrice value={c.unit_price} /></Td>
                <Td mono>{c.calculation_formula}</Td>
                <Td right><Money value={c.amount} /></Td>
              </tr>
            ))}
            <tr><Td className="font-semibold">Receita esperada</Td><Td /><Td /><Td mono>base + variável + ajuste − desconto</Td><Td right><Money value={d.expected?.expected_total} className="font-semibold" /></Td></tr>
          </tbody>
        </Table>
      </Section>

      <Section title="Faturamento">
        {ev("NO_BILLING_FOUND").length > 0 && <p className="text-sm text-warn">Nenhum faturamento encontrado para o cliente/contrato nesta competência.</p>}
        <ul className="space-y-1 text-sm">{ev("BILLING_EVENT").map((e) => (
          <li key={e.id}>{e.description} {e.source_import_id && <Link className="text-xs text-brand hover:underline" href={`/imports/${e.source_import_id}`}>(import de origem)</Link>}</li>
        ))}</ul>
      </Section>

      <Section title="Cálculos (reprodutibilidade)">
        <Table>
          <thead><tr><Th>Etapa</Th><Th>Motor</Th><Th>Status</Th><Th>Hash das entradas</Th><Th>Concluído</Th><Th>Origem</Th></tr></thead>
          <tbody>{d.runs.map((r) => (
            <tr key={r.id}>
              <Td>{r.calculation_type === "EXPECTED_REVENUE" ? "Receita esperada" : "Reconciliação"}</Td>
              <Td mono>{r.engine_name}@{r.engine_version}</Td>
              <Td><StatusBadge status={r.status} /></Td>
              <Td mono>{String(r.input_snapshot_hash).slice(0, 16)}…</Td>
              <Td><DateTime value={r.completed_at} /></Td>
              <Td>{r.triggered_by_type === "REPROCESSING" ? "reprocessamento" : "usuário"}</Td>
            </tr>
          ))}</tbody>
        </Table>
        <p className="mt-2 text-xs text-ink-3">Mesmas entradas e mesma versão de motor produzem o mesmo hash e o mesmo resultado. O snapshot completo fica armazenado no cálculo.</p>
      </Section>

      <Section title="Cadeia de evidências" description="Elos imutáveis e referenciados por chave; nenhuma evidência usada pode ser apagada.">
        <ol className="list-decimal space-y-1 pl-5 text-sm">{d.evidence.map((e) => <li key={e.id}><Badge>{e.evidence_type}</Badge> {e.description}</li>)}</ol>
      </Section>

      <Section title="Histórico de classificação">
        {d.actions.length === 0 ? <Empty title="Nenhuma ação humana ainda">Divergências nascem abertas; somente pessoas classificam.</Empty> : (
          <Table>
            <thead><tr><Th>Quando</Th><Th>Ação</Th><Th>De → para</Th><Th>Motivo / nota</Th><Th>Por</Th></tr></thead>
            <tbody>{d.actions.map((a) => (
              <tr key={a.id}>
                <Td><DateTime value={a.performed_at} /></Td><Td>{ACTION_LABELS[a.action_type]}</Td>
                <Td>{FINDING_STATUS_LABELS[a.previous_status]} → {FINDING_STATUS_LABELS[a.new_status]}</Td>
                <Td className="text-xs">{a.reason}{a.notes ? <div>{a.notes}</div> : null}{a.recovered_amount ? <div>Recuperado: <Money value={a.recovered_amount} /></div> : null}</Td>
                <Td>{a.performer_email}</Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Section>

      <Section title="Ações">
        {d.actionsAvailable.length === 0 ? <p className="text-sm text-ink-3">Seu papel não permite classificar esta divergência, ou ela é histórica.</p> : (
          <div className="grid gap-4 lg:grid-cols-2">
            {d.actionsAvailable.map((a) => (
              <div key={a} className="rounded-md border border-line p-3">
                <p className="text-sm font-medium">{ACTION_LABELS[a]}</p>
                <p className="mb-2 text-xs text-ink-3">{ACTION_HELP[a]}</p>
                <ActionForm action={classifyAction.bind(null, id, a)} submitLabel={ACTION_LABELS[a]!} variant={a === "CONFIRM" || a === "START_REVIEW" ? "primary" : "secondary"} resetOnSuccess>
                  {NEEDS_REASON.has(a) && <Field label="Motivo (obrigatório)"><textarea name="reason" required minLength={3} rows={2} className={inputCls} /></Field>}
                  {a === "MARK_RECOVERED" && <Field label="Valor recuperado (R$)" hint="Até o valor da diferença."><input name="recoveredAmount" required placeholder="4.760,00" className={inputCls} /></Field>}
                  {a === "NOTE" && <Field label="Anotação"><textarea name="notes" required rows={2} className={inputCls} /></Field>}
                  {a !== "NOTE" && !NEEDS_REASON.has(a) && a !== "MARK_RECOVERED" && <Field label="Observação (opcional)"><input name="notes" className={inputCls} /></Field>}
                </ActionForm>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-ink-3">Competência <Comp value={f.competence} />. Toda ação gera registro imutável e entrada na trilha de auditoria.</p>
      </Section>
    </>
  );
}
