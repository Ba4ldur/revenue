"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { classifyFinding } from "@/application/findings";
import { requireOrg } from "@/lib/session";
import { runAction, str, type ActionState } from "@/lib/actions";

export async function classifyAction(findingId: string, action: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  const res = await runAction(async () => {
    await classifyFinding(ctx, findingId, { action, reason: str(fd, "reason"), notes: str(fd, "notes"), recoveredAmount: str(fd, "recoveredAmount") });
    revalidatePath("/findings");
    revalidatePath("/dashboard");
  });
  if (res.error) return res;
  // O formulário da ação deixa de existir após a transição: confirmação vai para a página.
  redirect(`/findings/${findingId}?ok=${encodeURIComponent(action)}`);
}
