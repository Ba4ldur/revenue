import type { Metadata } from "next";
import Link from "next/link";
import { listCustomers } from "@/application/customers";
import { can } from "@/application/context";
import { formatCnpj } from "@/domain/cnpj";
import { requireOrg } from "@/lib/session";
import { ActionForm } from "@/components/forms";
import { Empty, Field, PageHeader, Section, StatusBadge, Table, Td, Th, inputCls } from "@/components/ui";
import { createCustomerAction } from "./actions";
import { CustomerFields } from "./customer-fields";

export const metadata: Metadata = { title: "Clientes" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireOrg();
  const { q } = await searchParams;
  const customers = await listCustomers(ctx, { q });
  return (
    <>
      <PageHeader title="Clientes" subtitle="Clientes da organização cujos contratos são verificados." />
      {can(ctx, "customers.write") && (
        <Section title="Novo cliente">
          <ActionForm action={createCustomerAction} submitLabel="Cadastrar cliente" resetOnSuccess>
            <CustomerFields />
          </ActionForm>
        </Section>
      )}
      <Section title={`Cadastrados (${customers.length})`} actions={
        <form className="w-64"><Field label=""><input name="q" defaultValue={q} placeholder="Buscar por nome ou CNPJ" className={inputCls} /></Field></form>
      }>
        {customers.length === 0 ? (
          <Empty title={q ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado"}>
            {q ? "Revise a busca." : "Cadastre o primeiro cliente para registrar contratos."}
          </Empty>
        ) : (
          <Table>
            <thead><tr><Th>Razão social</Th><Th>CNPJ</Th><Th>ID externo</Th><Th right>Contratos</Th><Th>Status</Th></tr></thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <Td><Link className="font-medium text-brand hover:underline" href={`/customers/${c.id}`}>{c.legalName}</Link>{c.tradeName && <div className="text-xs text-ink-3">{c.tradeName}</div>}</Td>
                  <Td mono>{formatCnpj(c.cnpj)}</Td>
                  <Td mono>{c.externalId ?? "—"}</Td>
                  <Td right>{c.contractCount}</Td>
                  <Td><StatusBadge status={c.status} label={c.status === "ACTIVE" ? "Ativo" : "Inativo"} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </>
  );
}
