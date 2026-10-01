import type { Metadata } from "next";
import { listAuditLogs } from "@/application/dashboard";
import { can } from "@/application/context";
import { requireOrg } from "@/lib/session";
import { DateTime, Empty, Field, Notice, PageHeader, Section, Table, Td, Th, inputCls } from "@/components/ui";

export const metadata: Metadata = { title: "Auditoria" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string; action?: string; page?: string }> }) {
  const ctx = await requireOrg();
  if (!can(ctx, "audit.read")) {
    return <><PageHeader title="Trilha de auditoria" /><Notice tone="warn">Disponível para administradores e auditores.</Notice></>;
  }
  const sp = await searchParams;
  const page = Number(sp.page ?? 0);
  const logs = await listAuditLogs(ctx, { entityType: sp.entity || null, action: sp.action || null, page });
  return (
    <>
      <PageHeader title="Trilha de auditoria" crumbs={[{ href: "/settings", label: "Configurações" }]} subtitle="Append-only: nenhum registro pode ser alterado ou apagado, inclusive por administradores." />
      <Section title="Filtros">
        <form className="grid gap-3 sm:grid-cols-4">
          <Field label="Entidade"><input name="entity" defaultValue={sp.entity ?? ""} placeholder="ex.: findings, contract_rules" className={inputCls} /></Field>
          <Field label="Ação contém"><input name="action" defaultValue={sp.action ?? ""} placeholder="ex.: update" className={inputCls} /></Field>
          <div className="flex items-end"><button className="rounded-md border border-line bg-paper px-3 py-1.5 text-sm">Filtrar</button></div>
        </form>
      </Section>
      <Section title="Registros">
        {logs.length === 0 ? <Empty title="Nenhum registro" /> : (
          <Table>
            <thead><tr><Th>Quando</Th><Th>Ator</Th><Th>Ação</Th><Th>Intenção</Th><Th>Entidade</Th><Th>Alterações</Th></tr></thead>
            <tbody>{logs.map((l) => {
              const before = (l.before_data ?? {}) as Record<string, unknown>;
              const after = (l.after_data ?? {}) as Record<string, unknown>;
              const changed = Object.keys(after).filter((k) => k !== "updated_at" && JSON.stringify(before[k]) !== JSON.stringify(after[k]) && l.before_data);
              return (
                <tr key={l.id}>
                  <Td><DateTime value={l.created_at} /></Td>
                  <Td>{l.actor_email ?? "—"}<div className="text-xs text-ink-3">{l.actor_type}</div></Td>
                  <Td mono>{l.action}</Td>
                  <Td mono>{(l.metadata as { intent?: string } | null)?.intent ?? "—"}</Td>
                  <Td mono>{l.entity_type}<div className="text-[10px]">{l.entity_id}</div></Td>
                  <Td className="text-xs">{changed.length ? changed.slice(0, 6).map((k) => <div key={k}><span className="font-mono">{k}</span>: {String(JSON.stringify(before[k]) ?? "∅").slice(0, 40)} → {String(JSON.stringify(after[k]) ?? "∅").slice(0, 40)}</div>) : l.before_data ? "—" : "criação"}</Td>
                </tr>
              );
            })}</tbody>
          </Table>
        )}
        <div className="mt-3 flex gap-3 text-sm">
          {page > 0 && <a className="text-brand" href={`?entity=${sp.entity ?? ""}&action=${sp.action ?? ""}&page=${page - 1}`}>← Mais recentes</a>}
          {logs.length === 100 && <a className="text-brand" href={`?entity=${sp.entity ?? ""}&action=${sp.action ?? ""}&page=${page + 1}`}>Mais antigos →</a>}
        </div>
      </Section>
    </>
  );
}
