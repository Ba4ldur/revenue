import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} não configurada`);
  return v;
}

/** Cliente Supabase Auth com a sessão do usuário (cookies httpOnly gerenciados pelo @supabase/ssr). */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server Components não podem gravar cookies; o proxy renova a sessão.
        }
      },
    },
  });
}

/** Usuário autenticado verificado no servidor de Auth (getUser valida o JWT; nunca confiamos só no cookie). */
export async function getAuthUser(): Promise<{ id: string; email?: string } | null> {
  const sb = await supabaseServer();
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? undefined };
}

/** Admin Auth (service role) — somente para convites de membros, após checagem de papel ADMIN. */
export const authAdmin = {
  async inviteOrGetUserId(email: string): Promise<string> {
    const admin = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${site}/login` });
    if (data?.user) return data.user.id;
    if (error && /already been registered|already registered|exists/i.test(error.message)) {
      // Usuário já existe: localizar pelo e-mail (paginação simples do Admin API).
      for (let page = 1; page <= 20; page++) {
        const { data: list, error: e2 } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (e2) throw new Error("Falha ao consultar usuários");
        const u = list.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
        if (u) return u.id;
        if (list.users.length < 200) break;
      }
    }
    throw new Error(`Falha ao convidar: ${error?.message ?? "desconhecida"}`);
  },
};
