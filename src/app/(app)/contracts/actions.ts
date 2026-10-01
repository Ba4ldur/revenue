"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAmendment, createContract } from "@/application/contracts";
import { uploadContractDocument } from "@/application/documents";
import { runRevenueAssurance } from "@/application/calculations";
import { createAndRunReprocessing } from "@/application/reprocessing";
import { invalid } from "@/application/errors";
import { parseCompetence } from "@/domain/competence";
import { formatBRL } from "@/domain/money/decimal";
import { requireOrg } from "@/lib/session";
import { fileFrom, runAction, str, type ActionState } from "@/lib/actions";

function competence(fd: FormData, key: string) {
  const c = parseCompetence(str(fd, key) ?? "");
  if (!c.ok) throw invalid(`Competência: ${c.error}`);
  return c.value;
}

export async function createContractAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  let id = "";
  const res = await runAction(async () => {
    const r = await createContract(ctx, {
      customerId: str(fd, "customerId"), contractNumber: str(fd, "contractNumber"), title: str(fd, "title"),
      startDate: str(fd, "startDate"), endDate: str(fd, "endDate"), renewalType: str(fd, "renewalType"),
    });
    id = r.contractId;
  });
  if (res.error) return res;
  redirect(`/contracts/${id}`);
}

export async function uploadDocumentAction(contractId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  return runAction(async () => {
    const file = await fileFrom(fd, "file");
    if (!file) throw invalid("Selecione um arquivo PDF");
    const r = await uploadContractDocument(ctx, { contractId, contractVersionId: str(fd, "versionId"), documentType: str(fd, "documentType") ?? "CONTRACT", file });
    revalidatePath(`/contracts/${contractId}`);
    return { ok: true, message: r.duplicate ? "Este arquivo já estava anexado ao contrato (mesmo hash)." : "Documento armazenado com texto extraído por página." };
  });
}

export async function runCalculationAction(contractId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  return runAction(async () => {
    const r = await runRevenueAssurance(ctx, contractId, competence(fd, "competence"));
    revalidatePath(`/contracts/${contractId}`);
    if (r.expected.status === "NOT_APPLICABLE") return { error: r.expected.message };
    if (r.expected.status === "NEEDS_REVIEW") return { error: `Cálculo requer revisão: ${r.expected.message}` };
    if (r.reconciliation.status === "NEEDS_REVIEW") return { error: `Reconciliação requer revisão: ${r.reconciliation.message}` };
    const reused = r.expected.status === "REUSED" && r.reconciliation.status === "REUSED";
    const diff = r.reconciliation.differenceAmount ? formatBRL(r.reconciliation.differenceAmount) : "—";
    return { ok: true, message: `${reused ? "Entradas inalteradas; resultado existente reutilizado." : "Cálculo registrado."} Esperado ${formatBRL(r.expected.expectedTotal ?? "0")}, diferença ${diff}${r.findingId ? " — divergência aberta para revisão." : "."}` };
  });
}

export async function amendmentAction(contractId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  return runAction(async () => {
    await createAmendment(ctx, contractId, { validFrom: str(fd, "validFrom"), notes: str(fd, "notes"), carryRules: fd.get("carryRules") === "on" });
    revalidatePath(`/contracts/${contractId}`);
    return { ok: true, message: "Nova versão criada. Regras copiadas aguardam confirmação na tela de regras." };
  });
}

export async function reprocessContractAction(contractId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  return runAction(async () => {
    const r = await createAndRunReprocessing(ctx, {
      reason: str(fd, "reason"), triggerEntityType: "contracts", triggerEntityId: contractId, contractIds: [contractId],
      affectedFrom: competence(fd, "from"), affectedUntil: competence(fd, "until"),
    });
    revalidatePath(`/contracts/${contractId}`);
    const changed = r.items.filter((i) => i.changed).length;
    return { ok: true, message: `Reprocessamento concluído: ${r.items.length} competência(s), ${changed} com resultado alterado. Histórico preservado.` };
  });
}
