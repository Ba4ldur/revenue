"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listMemberships } from "@/application/context";
import { requireUser, ORG_COOKIE } from "@/lib/session";

export async function switchOrg(fd: FormData): Promise<void> {
  const user = await requireUser();
  const orgId = String(fd.get("orgId") ?? "");
  // Só aceita organização da qual o usuário é membro ativo.
  if ((await listMemberships(user.id)).some((m) => m.orgId === orgId)) {
    (await cookies()).set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  }
  redirect("/dashboard");
}
