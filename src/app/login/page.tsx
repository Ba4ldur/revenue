import type { Metadata } from "next";
import { ActionForm } from "@/components/forms";
import { Field, inputCls } from "@/components/ui";
import { signIn, signUp } from "./actions";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  const signup = mode === "signup";
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-brand">Revenue Intelligence</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{signup ? "Criar conta" : "Entrar"}</h1>
      <p className="mt-1 text-sm text-ink-3">Verificação independente entre contrato, operação e faturamento.</p>
      <div className="mt-6 rounded-md border border-line bg-paper p-5">
        <ActionForm action={signup ? signUp : signIn} submitLabel={signup ? "Criar conta" : "Entrar"} pendingLabel="Aguarde…">
          {signup && (
            <Field label="Nome completo">
              <input name="fullName" required autoComplete="name" className={inputCls} />
            </Field>
          )}
          <Field label="E-mail">
            <input name="email" type="email" required autoComplete="email" className={inputCls} />
          </Field>
          <Field label="Senha" hint={signup ? "Mínimo de 10 caracteres, com maiúsculas, minúsculas e números." : undefined}>
            <input name="password" type="password" required minLength={10} autoComplete={signup ? "new-password" : "current-password"} className={inputCls} />
          </Field>
        </ActionForm>
      </div>
      <p className="mt-4 text-sm text-ink-3">
        {signup ? <>Já tem conta? <a className="text-brand underline" href="/login">Entrar</a></> : <>Primeiro acesso? <a className="text-brand underline" href="/login?mode=signup">Criar conta</a></>}
      </p>
    </main>
  );
}
