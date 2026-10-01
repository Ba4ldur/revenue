import type { Metadata } from "next";
import Link from "next/link";
import { listFindings, FINDING_STATUSES } from "@/application/findings";
import { FINDING_STATUS_LABELS } from "@/domain/findings/labels";
import { FINDING_TYPE_LABELS } from "@/domain/reconciliation/reconciliation-engine";
import { parseCompetence } from "@/domain/competence";
import { sum } from "@/domain/money/decimal";
import { requireOrg } from "@/lib/session";
import { Comp, Empty, Field, FindingTypeLabel, Money, PageHeader, Section, StatusBadge, Table, Td, Th, inputCls } from "@/components/ui";

export const metadata: Metadata = { title: "Divergências" };

export default async function FindingsPage({ searchParams }: { searchParams: Promise<{ status?: string; type?: string; competence?: string; history?: string }> }) {
  const ctx = await requireOrg();
  const sp = await searchParams;
  const comp = sp.competence ? parseCompetence(sp.competence) : null;
  const findings = await listFindings(ctx, {
    status: sp.status || undefined, type: sp.type || undefined, competence: comp?.ok ? comp.value : undefined, includeSuperseded: sp.history === "1",
  });
  const total = sum(findings.map((f) => f.difference_amount as string));
  return (
    <>
      <PageHeader title="Divergências" subtitle="Possíveis diferenças entre o esperado pelo contrato e o faturado. Divergência não é perda confirmada." />
      <Section title="Filtros">
        <form className="grid gap-3 sm:grid-cols-5">
          <Field label="Status"><select name="status" defaultValue={sp.status ?? ""} className={inputCls}><option value="">Todos</option>{FINDING_STATUSES.map((s) => <option key={s} value={s}>{FINDING_STATUS_LABELS[s]}</option>)}</select></Field>
          <Field label="Tipo"><select name="type" defaultValue={sp.type ?? ""} className={inputCls}><option value="">Todos</option>{Object.entries(FINDING_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Competência (MM/AAAA)"><input name="competence" defaultValue={sp.competence ?? ""} className={inputCls} /></Field>
          <label className="flex items-end gap-2 pb-1.5 text-sm"><input type="checkbox" name="history" value="1" defaultChecked={sp.history === "1"} /> incluir substituídas</label>
          <div className="flex items-end"><button className="rounded-md border border-line bg-paper px-3 py-1.5 text-sm">Aplicar</button></div>
        </form>
        {comp && !comp.ok && <p className="mt-2 text-sm text-bad">{comp.error}</p>}
      </Section>
      <Section title={`${findings.length} divergência(s)`} description={<>Soma das diferenças listadas: <Money value={total.toFixed(2)} /></>}>
        {findings.length === 0 ? <Empty title="Nenhuma divergência para os filtros">Divergências surgem ao calcular competências com regras ativas, operação e faturamento importados.</Empty> : (
          <Table>
            <thead><tr><Th>Competência</Th><Th>Cliente / contrato</Th><Th>Tipo</Th><Th right>Esperado</Th><Th right>Faturado</Th><Th right>Diferença</Th><Th>Severidade</Th><Th>Status</Th></tr></thead>
            <tbody>{findings.map((f) => (
              <tr key={f.id} className={f.run_status !== "COMPLETED" ? "opacity-60" : ""}>
                <Td><Comp value={f.competence} /></Td>
                <Td>{f.customer_name}<div className="text-xs text-ink-3">{f.contract_number}</div></Td>
                <Td><Link className="font-medium text-brand hover:underline" href={`/findings/${f.id}`}><FindingTypeLabel type={f.finding_type} /></Link>{f.run_status !== "COMPLETED" && <div className="text-xs">substituída por recálculo</div>}</Td>
                <Td right><Money value={f.expected_amount} /></Td><Td right><Money value={f.billed_amount} /></Td>
                <Td right><Money value={f.difference_amount} className="font-semibold" /></Td>
                <Td>{f.severity}</Td><Td><StatusBadge status={f.status} /></Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Section>
    </>
  );
}
