import type { Metadata } from "next";
import { listMembers } from "@/application/organizations";
import { can, ROLE_LABELS, type Role } from "@/application/context";
import { requireOrg } from "@/lib/session";
import { ActionForm } from "@/components/forms";
import { DateTime, Field, PageHeader, Section, StatusBadge, Table, Td, Th, inputCls } from "@/components/ui";
import { inviteAction, updateMemberAction } from "../actions";

export const metadata: Metadata = { title: "Membros" };
const ROLES = Object.keys(ROLE_LABELS) as Role[];

export default async function MembersPage() {
  const ctx = await requireOrg();
  const members = await listMembers(ctx);
  const admin = can(ctx, "members.manage");
  return (
    <>
      <PageHeader title="Membros e papéis" crumbs={[{ href: "/settings", label: "Configurações" }]}
        subtitle="Permissões calculadas pelo vínculo (menor privilégio). Sempre deve existir ao menos um administrador ativo." />
      {admin && (
        <Section title="Convidar">
          <ActionForm action={inviteAction} submitLabel="Convidar" resetOnSuccess inline>
            <Field label="E-mail"><input name="email" type="email" required className={`${inputCls} w-72`} /></Field>
            <Field label="Papel"><select name="role" className={inputCls}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></Field>
          </ActionForm>
        </Section>
      )}
      <Section title={`Membros (${members.length})`}>
        <Table>
          <thead><tr><Th>Pessoa</Th><Th>Papel</Th><Th>Status</Th><Th>Desde</Th>{admin && <Th />}</tr></thead>
          <tbody>{members.map((m) => (
            <tr key={m.id}>
              <Td>{m.fullName ?? "—"}<div className="text-xs text-ink-3">{m.email}</div></Td>
              <Td>{ROLE_LABELS[m.role]}</Td>
              <Td><StatusBadge status={m.status} /></Td>
              <Td><DateTime value={m.joinedAt} /></Td>
              {admin && (
                <Td>
                  {m.userId !== ctx.userId && (
                    <div className="flex flex-wrap gap-2">
                      <ActionForm action={updateMemberAction.bind(null, m.id)} submitLabel="Alterar papel" variant="secondary" inline>
                        <select name="role" defaultValue={m.role} className={inputCls}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select>
                      </ActionForm>
                      {m.status === "ACTIVE" && <ActionForm action={updateMemberAction.bind(null, m.id)} submitLabel="Desativar" variant="danger" inline confirmMessage="Desativar o acesso desta pessoa?"><input type="hidden" name="status" value="DISABLED" /></ActionForm>}
                      {m.status === "DISABLED" && <ActionForm action={updateMemberAction.bind(null, m.id)} submitLabel="Reativar" variant="secondary" inline><input type="hidden" name="status" value="ACTIVE" /></ActionForm>}
                    </div>
                  )}
                </Td>
              )}
            </tr>
          ))}</tbody>
        </Table>
      </Section>
    </>
  );
}
