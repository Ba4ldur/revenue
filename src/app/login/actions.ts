"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { supabaseServer } from "@/infrastructure/auth/supabase";
import type { ActionState } from "@/lib/actions";

const Credentials = z.object({
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  password: z.string().min(10, "A senha deve ter ao menos 10 caracteres").max(200),
});

export async function signIn(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = Credentials.safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!p.success) return { error: p.error.issues[0]?.message };
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword(p.data);
  // Mensagem genérica: não revela se o e-mail existe.
  if (error) return { error: "E-mail ou senha incorretos." };
  redirect("/dashboard");
}

export async function signUp(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = Credentials.extend({ fullName: z.string().trim().min(2, "Informe seu nome").max(200) })
    .safeParse({ email: fd.get("email"), password: fd.get("password"), fullName: fd.get("fullName") });
  if (!p.success) return { error: p.error.issues[0]?.message };
  const sb = await supabaseServer();
  const { data, error } = await sb.auth.signUp({ email: p.data.email, password: p.data.password, options: { data: { full_name: p.data.fullName } } });
  if (error) return { error: /password/i.test(error.message) ? "Senha fraca: use letras maiúsculas, minúsculas e números." : "Não foi possível criar a conta." };
  if (!data.session) return { ok: true, message: "Conta criada. Confirme o e-mail para entrar." };
  redirect("/onboarding");
}
