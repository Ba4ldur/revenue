import { Field, inputCls } from "@/components/ui";

export function CustomerFields({ d }: { d?: { legalName?: string; tradeName?: string | null; cnpj?: string | null; externalId?: string | null } }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Razão social"><input name="legalName" required defaultValue={d?.legalName} className={inputCls} /></Field>
      <Field label="Nome fantasia"><input name="tradeName" defaultValue={d?.tradeName ?? ""} className={inputCls} /></Field>
      <Field label="CNPJ" hint="Numérico ou alfanumérico; validado pelo DV."><input name="cnpj" defaultValue={d?.cnpj ?? ""} className={inputCls} /></Field>
      <Field label="ID no sistema de origem" hint="Usado para vincular importações (ex.: código no ERP)."><input name="externalId" defaultValue={d?.externalId ?? ""} className={inputCls} /></Field>
    </div>
  );
}
