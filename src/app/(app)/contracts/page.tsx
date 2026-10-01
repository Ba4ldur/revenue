import type { Metadata } from "next";
import Link from "next/link";
import { listContracts } from "@/application/contracts";
import { listCustomers } from "@/application/customers";
import { can } from "@/application/context";
import { requireOrg } from "@/lib/session";
import { ActionForm } from "@/components/forms";
import { DateBR, Empty, Field, PageHeader, Section, StatusBadge, Table, Td, Th, inputCls } from "@/components/ui";
import { createContractAction } from "./actions";

export const metadata: Metadata = { title: "Contratos" };

export default async function ContractsPage({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  const ctx = await requireOrg();
  const { customerId } = await searchParams;
  const [contracts, customers] = await Promise.all([listContracts(ctx), listCustomers(ctx)]);
  return (
    <>
      <PageHeader title="Contratos" subtitle="Relações comerciais. As regras pertencem às versões do contrato." />
      {can(ctx, "contracts.write") && (
        <Section title="Novo contrato" description="Cria o contrato e a versão 1 com a mesma vigência.">
          {customers.length === 0 ? <Empty title="Cadastre um cliente antes"><Link className="text-brand underline" href="/customers">Ir para clientes</Link></Empty> : (
            <ActionForm action={createContractAction} submitLabel="Criar contrato">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Cliente">
                  <select name="customerId" required defaultValue={customerId ?? ""} className={inputCls}>
                    <option value="" disabled>Selecione</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.legalName}</option>)}
                  </select>
                </Field>
                <Field label="Número do contrato"><input name="contractNumber" required className={inputCls} /></Field>
                <Field label="Título"><input name="title" required className={inputCls} /></Field>
                <Field label="Início da vigência"><input name="startDate" type="date" required className={inputCls} /></Field>
                <Field label="Fim (opcional)"><input name="endDate" type="date" className={inputCls} /></Field>
                <Field label="Renovação">
                  <select name="renewalType" defaultValue="" className={inputCls}>
                    <option value="">Não informado</option><option value="NONE">Sem renovação</option>
                    <option value="AUTOMATIC">Automática</option><option value="MANUAL">Manual</option>
                  </select>
                </Field>
              </div>
            </ActionForm>
          )}
        </Section>
      )}
      <Section title={`Contratos (${contracts.length})`}>
        {contracts.length === 0 ? <Empty title="Nenhum contrato cadastrado" /> : (
          <Table>
            <thead><tr><Th>Número</Th><Th>Cliente</Th><Th>Título</Th><Th>Vigência</Th><Th>Status</Th></tr></thead>
            <tbody>{contracts.map((k) => (
              <tr key={k.id}>
                <Td><Link className="font-medium text-brand hover:underline" href={`/contracts/${k.id}`}>{k.contractNumber}</Link></Td>
                <Td>{k.customerName}</Td><Td>{k.title}</Td>
                <Td><DateBR value={k.startDate} /> – {k.endDate ? <DateBR value={k.endDate} /> : "indeterminado"}</Td>
                <Td><StatusBadge status={k.status} /></Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Section>
    </>
  );
}
