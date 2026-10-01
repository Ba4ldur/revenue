import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/forms";
import { Field, inputCls } from "@/components/ui";
import { listMemberships } from "@/application/context";
import { requireUser } from "@/lib/session";
import { createOrgAction } from "./actions";

export const metadata: Metadata = { title: "Organização" };

export default async function OnboardingPage() {
  const user = await requireUser();
  if ((await listMemberships(user.id)).length > 0) redirect("/dashboard");
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Cadastre sua organização</h1>
      <p className="mt-1 text-sm text-ink-3">
        Você será o administrador. Se foi convidado por outra empresa, peça ao administrador que confirme o convite para {user.email}.
      </p>
      <div className="mt-6 rounded-md border border-line bg-paper p-5">
        <ActionForm action={createOrgAction} submitLabel="Criar organização">
          <Field label="Razão social"><input name="legalName" required className={inputCls} /></Field>
          <Field label="Nome fantasia (opcional)"><input name="tradeName" className={inputCls} /></Field>
          <Field label="CNPJ (opcional)" hint="Validado pelo dígito verificador."><input name="cnpj" className={inputCls} inputMode="text" /></Field>
        </ActionForm>
      </div>
    </main>
  );
}
