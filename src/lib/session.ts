import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/infrastructure/auth/supabase";
import { resolveOrgContext, type OrgContext } from "@/application/context";

export const ORG_COOKIE = "ri_org";

export const requireUser = cache(async () => {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  return user;
});

/** Contexto da organização ativa — vínculo revalidado no banco a cada requisição. */
export const requireOrg = cache(async (): Promise<OrgContext> => {
  const user = await requireUser();
  const orgId = (await cookies()).get(ORG_COOKIE)?.value ?? null;
  const ctx = await resolveOrgContext(user, orgId);
  if (!ctx) redirect("/onboarding");
  return ctx;
});
