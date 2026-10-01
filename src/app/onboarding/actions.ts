"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createOrganization } from "@/application/organizations";
import { requireUser, ORG_COOKIE } from "@/lib/session";
import { runAction, str, type ActionState } from "@/lib/actions";

export async function createOrgAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  let orgId = "";
  const res = await runAction(async () => {
    orgId = await createOrganization(user, { legalName: str(fd, "legalName"), tradeName: str(fd, "tradeName"), cnpj: str(fd, "cnpj") });
  });
  if (res.error) return res;
  (await cookies()).set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  redirect("/dashboard");
}
