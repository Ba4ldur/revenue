"use server";

import { revalidatePath } from "next/cache";
import { createCustomer, updateCustomer } from "@/application/customers";
import { requireOrg } from "@/lib/session";
import { runAction, str, type ActionState } from "@/lib/actions";

const fields = (fd: FormData) => ({ legalName: str(fd, "legalName"), tradeName: str(fd, "tradeName"), cnpj: str(fd, "cnpj"), externalId: str(fd, "externalId") });

export async function createCustomerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  return runAction(async () => {
    await createCustomer(ctx, fields(fd));
    revalidatePath("/customers");
    return { ok: true, message: "Cliente cadastrado." };
  });
}

export async function updateCustomerAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  return runAction(async () => {
    await updateCustomer(ctx, id, fields(fd));
    revalidatePath(`/customers/${id}`);
    return { ok: true, message: "Alterações salvas (registradas na auditoria)." };
  });
}
