"use server";

import { revalidatePath } from "next/cache";
import { inviteMember, setMaterialityPolicy, updateMember } from "@/application/organizations";
import { authAdmin } from "@/infrastructure/auth/supabase";
import { requireOrg } from "@/lib/session";
import { runAction, str, type ActionState } from "@/lib/actions";

export async function inviteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  return runAction(async () => {
    await inviteMember(ctx, { email: str(fd, "email"), role: str(fd, "role") }, authAdmin);
    revalidatePath("/settings/members");
    return { ok: true, message: "Convite registrado. O acesso é ativado no primeiro login do convidado." };
  });
}

export async function updateMemberAction(memberId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  return runAction(async () => {
    await updateMember(ctx, { memberId, role: str(fd, "role") ?? undefined, status: str(fd, "status") ?? undefined });
    revalidatePath("/settings/members");
    return { ok: true, message: "Vínculo atualizado (auditado)." };
  });
}

export async function materialityAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  return runAction(async () => {
    await setMaterialityPolicy(ctx, {
      mode: str(fd, "mode"), absoluteThreshold: str(fd, "absoluteThreshold"), percentagePoints: str(fd, "percentagePoints"),
      combinationOperator: str(fd, "combinationOperator"),
    });
    revalidatePath("/settings/materiality");
    return { ok: true, message: "Nova versão da política ativa. Divergências existentes não foram apagadas; reprocesse para reavaliar." };
  });
}
