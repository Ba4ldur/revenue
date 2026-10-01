import type { Metadata } from "next";
import Link from "next/link";
import { getDashboard } from "@/application/dashboard";
import { FINDING_STATUS_LABELS } from "@/domain/findings/labels";
import { formatCompetence } from "@/domain/competence";
import { sum } from "@/domain/money/decimal";
import { requireOrg } from "@/lib/session";
import { Comp, Empty, FindingTypeLabel, Money, Notice, PageHeader, Section, StatusBadge, Table, Td, Th } from "@/components/ui";

export const metadata: Metadata = { title: "Painel" };

function Card({ label, value, detail, href }: { label: string; value: React.ReactNode; detail?: React.ReactNode; href?: string }) {
  const body = (
    <div className="rounded-md border border-line bg-paper p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {detail && <p className="mt-1 text-xs text-ink-3">{detail}</p>}
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{body}</Link> : body;
}

export default async function DashboardPage() {
  const ctx = await requireOrg();
  const d = await getDashboard(ctx);
  const m = d.monitored;
  const fpRate = d.falsePositive.classified ? `${Math.round((d.falsePositive.n / d.falsePositive.classified) * 100)}%` : "—";
  return (
    <>
      <PageHeader title="Painel" subtitle="Somente resultados de cálculos correntes. Divergência é possibilidade de receita não faturada até a revisão humana." />
      {d.scopesNeedingReview > 0 && <Notice tone="warn">{d.scopesNeedingReview} competência(s) com última tentativa de cálculo exigindo revisão (dados incompletos, ambiguidade ou regra não suportada). Veja nos contratos.</Notice>}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Receita monitorada" value={<Money value={m.total} />} detail={m.scopes ? `${m.contracts} contrato(s), ${m.scopes} competência(s): ${formatCompetence(m.first_competence)} a ${formatCompetence(m.last_competence)}` : "Nenhuma competência calculada"} href="/contracts" />
        <Card label="Divergências abertas" value={<Money value={sum([d.open.amountOpen, d.open.amountReview]).toFixed(2)} />} detail={`${d.open.n} em aberto ou em revisão`} href="/findings?status=OPEN" />
        <Card label="Divergências confirmadas" value={<Money value={d.confirmed.amount} />} detail={`${d.confirmed.n} confirmada(s) por revisão humana`} href="/findings?status=CONFIRMED" />
        <Card label="Receita recuperada" value={<Money value={d.recovered.amount} />} detail={d.recovered.n ? `${d.recovered.n} registro(s) de recuperação` : "Registrada manualmente na divergência (sem integração de recebimentos no MVP)"} href="/findings?status=RECOVERED" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Maiores divergências em aberto">
          {d.top.length === 0 ? <Empty title="Nenhuma divergência em aberto" /> : (
            <Table><thead><tr><Th>Cliente</Th><Th>Competência</Th><Th>Tipo</Th><Th right>Diferença</Th></tr></thead>
              <tbody>{d.top.map((f) => (
                <tr key={f.id}><Td>{f.customer_name}<div className="text-xs text-ink-3">{f.contract_number}</div></Td><Td><Comp value={f.competence} /></Td>
                  <Td><Link className="text-brand hover:underline" href={`/findings/${f.id}`}><FindingTypeLabel type={f.finding_type} /></Link></Td><Td right><Money value={f.difference_amount} /></Td></tr>
              ))}</tbody></Table>
          )}
        </Section>
        <Section title="Divergências recentes">
          {d.recent.length === 0 ? <Empty title="Nenhuma divergência detectada" /> : (
            <Table><thead><tr><Th>Cliente</Th><Th>Competência</Th><Th>Status</Th><Th right>Diferença</Th></tr></thead>
              <tbody>{d.recent.map((f) => (
                <tr key={f.id}><Td><Link className="text-brand hover:underline" href={`/findings/${f.id}`}>{f.customer_name}</Link></Td><Td><Comp value={f.competence} /></Td>
                  <Td><StatusBadge status={f.status} /></Td><Td right><Money value={f.difference_amount} /></Td></tr>
              ))}</tbody></Table>
          )}
        </Section>
        <Section title="Contratos com maior impacto" description="Abertas, em revisão e confirmadas.">
          {d.contracts.length === 0 ? <Empty title="Sem impacto registrado" /> : (
            <Table><thead><tr><Th>Contrato</Th><Th right>Divergências</Th><Th right>Total</Th></tr></thead>
              <tbody>{d.contracts.map((k) => (
                <tr key={k.id}><Td><Link className="text-brand hover:underline" href={`/contracts/${k.id}`}>{k.contract_number}</Link><div className="text-xs text-ink-3">{k.customer_name}</div></Td><Td right>{k.n}</Td><Td right><Money value={k.amount} /></Td></tr>
              ))}</tbody></Table>
          )}
        </Section>
        <Section title="Distribuição" description={`Taxa de falso positivo entre classificadas: ${fpRate}`}>
          {d.byStatus.length === 0 ? <Empty title="Sem dados" /> : (
            <div className="space-y-4">
              <Table><thead><tr><Th>Status</Th><Th right>Qtd.</Th><Th right>Valor</Th></tr></thead>
                <tbody>{d.byStatus.map((s) => <tr key={s.status}><Td><Link className="hover:underline" href={`/findings?status=${s.status}`}>{FINDING_STATUS_LABELS[s.status]}</Link></Td><Td right>{s.n}</Td><Td right><Money value={s.amount} /></Td></tr>)}</tbody></Table>
              <Table><thead><tr><Th>Tipo (ativas)</Th><Th right>Qtd.</Th><Th right>Valor</Th></tr></thead>
                <tbody>{d.byType.map((t) => <tr key={t.finding_type}><Td><FindingTypeLabel type={t.finding_type} /></Td><Td right>{t.n}</Td><Td right><Money value={t.amount} /></Td></tr>)}</tbody></Table>
            </div>
          )}
        </Section>
      </div>
    </>
  );
}

