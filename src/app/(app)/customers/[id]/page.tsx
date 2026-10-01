import Link from "next/link";
import { getCustomer } from "@/application/customers";
import { listContracts } from "@/application/contracts";
import { listFindings } from "@/application/findings";
import { can } from "@/application/context";
import { formatCnpj } from "@/domain/cnpj";
import { requireOrg } from "@/lib/session";
import { ActionForm } from "@/components/forms";
import { Comp, DateBR, Empty, FindingTypeLabel, KeyValue, LinkButton, Money, PageHeader, Section, StatusBadge, Table, Td, Th } from "@/components/ui";
import { updateCustomerAction } from "../actions";
import { CustomerFields } from "../customer-fields";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg();
  const customer = await getCustomer(ctx, id);
  const contracts = await listContracts(ctx, { customerId: id });
  const findings = (await Promise.all(contracts.map((k) => listFindings(ctx, { contractId: k.id })))).flat();
  return (
    <>
      <PageHeader title={customer.legalName} subtitle={customer.tradeName ?? undefined} crumbs={[{ href: "/customers", label: "Clientes" }]}
        actions={can(ctx, "contracts.write") ? <LinkButton href={`/contracts?customerId=${id}`} variant="primary">Novo contrato</LinkButton> : undefined} />
      <Section title="Dados cadastrais">
        <KeyValue items={[["CNPJ", <span key="c" className="font-mono">{formatCnpj(customer.cnpj)}</span>], ["ID externo", customer.externalId ?? "—"], ["Status", <StatusBadge key="s" status={customer.status} label={customer.status === "ACTIVE" ? "Ativo" : "Inativo"} />]]} />
        {can(ctx, "customers.write") && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-brand">Editar</summary>
            <div className="mt-3"><ActionForm action={updateCustomerAction.bind(null, id)} submitLabel="Salvar"><CustomerFields d={customer} /></ActionForm></div>
          </details>
        )}
      </Section>
      <Section title="Contratos">
        {contracts.length === 0 ? <Empty title="Nenhum contrato para este cliente" /> : (
          <Table>
            <thead><tr><Th>Número</Th><Th>Título</Th><Th>Vigência</Th><Th>Status</Th></tr></thead>
            <tbody>{contracts.map((k) => (
              <tr key={k.id}><Td><Link className="font-medium text-brand hover:underline" href={`/contracts/${k.id}`}>{k.contractNumber}</Link></Td><Td>{k.title}</Td>
                <Td><DateBR value={k.startDate} /> – {k.endDate ? <DateBR value={k.endDate} /> : "indeterminado"}</Td><Td><StatusBadge status={k.status} /></Td></tr>
            ))}</tbody>
          </Table>
        )}
      </Section>
      <Section title="Divergências correntes">
        {findings.length === 0 ? <Empty title="Nenhuma divergência registrada" /> : (
          <Table>
            <thead><tr><Th>Competência</Th><Th>Tipo</Th><Th right>Diferença</Th><Th>Status</Th></tr></thead>
            <tbody>{findings.map((f) => (
              <tr key={f.id}><Td><Comp value={f.competence} /></Td><Td><Link className="text-brand hover:underline" href={`/findings/${f.id}`}><FindingTypeLabel type={f.finding_type} /></Link></Td>
                <Td right><Money value={f.difference_amount} /></Td><Td><StatusBadge status={f.status} /></Td></tr>
            ))}</tbody>
          </Table>
        )}
      </Section>
    </>
  );
}
