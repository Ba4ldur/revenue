import type { Metadata } from "next";
import { listMaterialityPolicies } from "@/application/organizations";
import { can } from "@/application/context";
import { formatPercentFraction } from "@/domain/money/decimal";
import { requireOrg } from "@/lib/session";
import { ActionForm } from "@/components/forms";
import { DateTime, Field, Money, Notice, PageHeader, Section, StatusBadge, Table, Td, Th, inputCls } from "@/components/ui";
import { materialityAction } from "../actions";

export const metadata: Metadata = { title: "Materialidade" };
const MODE: Record<string, string> = { ABSOLUTE: "Absoluto", PERCENTAGE: "Percentual", COMBINED: "Combinado" };

export default async function MaterialityPage() {
  const ctx = await requireOrg();
  const policies = await listMaterialityPolicies(ctx);
  const active = policies.find((p) => p.status === "ACTIVE");
  return (
    <>
      <PageHeader title="Materialidade" crumbs={[{ href: "/settings", label: "Configurações" }]}
        subtitle="Define a partir de qual diferença entre esperado e faturado uma divergência é aberta." />
      <Notice>
        <p><strong>AND</strong>: a divergência só é aberta quando a diferença atinge <em>os dois</em> limites (ex.: ≥ R$ 500 <em>e</em> ≥ 1% do esperado). Menos alertas, ignora diferenças pequenas em contratos grandes e diferenças relativas pequenas.</p>
        <p className="mt-1"><strong>OR</strong>: basta atingir <em>um</em> dos limites. Mais alertas: R$ 600 em um contrato de R$ 100.000 (0,6%) já abre divergência.</p>
        <p className="mt-1">O percentual é calculado sobre a receita esperada da competência e os limites são inclusivos (≥). Alterar a política cria nova versão; divergências antigas são preservadas e podem ser reavaliadas por reprocessamento.</p>
      </Notice>
      {active && (
        <Section title={`Política vigente (v${active.version})`}>
          <p className="text-sm">{MODE[active.mode]}{active.combinationOperator ? ` ${active.combinationOperator}` : ""}: {active.absoluteThreshold && <>absoluto <Money value={active.absoluteThreshold} /></>} {active.percentageThreshold && <>· percentual {formatPercentFraction(active.percentageThreshold)}</>}</p>
        </Section>
      )}
      {can(ctx, "materiality.write") && (
        <Section title="Nova política">
          <ActionForm action={materialityAction} submitLabel="Salvar nova versão">
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Modo"><select name="mode" defaultValue={active?.mode ?? "COMBINED"} className={inputCls}><option value="ABSOLUTE">Absoluto</option><option value="PERCENTAGE">Percentual</option><option value="COMBINED">Combinado</option></select></Field>
              <Field label="Limite absoluto (R$)" hint="Usado em Absoluto e Combinado."><input name="absoluteThreshold" defaultValue={active?.absoluteThreshold ?? "500.00"} className={inputCls} /></Field>
              <Field label="Limite percentual (%)" hint="Ex.: 1 = 1%. Usado em Percentual e Combinado."><input name="percentagePoints" defaultValue={active?.percentageThreshold ? formatPercentFraction(active.percentageThreshold).replace("%", "").replace(",", ".") : "1"} className={inputCls} /></Field>
              <Field label="Combinação"><select name="combinationOperator" defaultValue={active?.combinationOperator ?? "AND"} className={inputCls}><option value="AND">AND (ambos)</option><option value="OR">OR (qualquer)</option></select></Field>
            </div>
          </ActionForm>
        </Section>
      )}
      <Section title="Histórico de versões">
        <Table>
          <thead><tr><Th>Versão</Th><Th>Modo</Th><Th right>Absoluto</Th><Th right>Percentual</Th><Th>Status</Th><Th>Criada</Th></tr></thead>
          <tbody>{policies.map((p) => (
            <tr key={p.id}><Td>v{p.version}</Td><Td>{MODE[p.mode]} {p.combinationOperator ?? ""}</Td><Td right><Money value={p.absoluteThreshold} /></Td>
              <Td right>{p.percentageThreshold ? formatPercentFraction(p.percentageThreshold) : "—"}</Td><Td><StatusBadge status={p.status} /></Td>
              <Td><DateTime value={p.createdAt} /><div className="text-xs text-ink-3">{p.createdByEmail}</div></Td></tr>
          ))}</tbody>
        </Table>
      </Section>
    </>
  );
}
