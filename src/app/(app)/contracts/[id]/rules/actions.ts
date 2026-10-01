"use server";

import { revalidatePath } from "next/cache";
import { activateRule, confirmRule, createManualRule, extractRulesFromDocument, rejectRule } from "@/application/rules";
import { getExtractionProvider } from "@/ai/factory";
import { requireOrg } from "@/lib/session";
import { runAction, str, type ActionState } from "@/lib/actions";
import { formatCompetence } from "@/domain/competence";

const ruleFields = (fd: FormData) => ({
  ruleType: str(fd, "ruleType"), value: str(fd, "value"), unit: str(fd, "unit"), validFrom: str(fd, "validFrom"),
  validUntil: str(fd, "validUntil"), sourcePage: str(fd, "sourcePage"), sourceText: str(fd, "sourceText"), textValue: str(fd, "textValue"),
});

export async function extractAction(contractId: string, documentId: string, _: ActionState): Promise<ActionState> {
  const ctx = await requireOrg();
  return runAction(async () => {
    const r = await extractRulesFromDocument(ctx, documentId, getExtractionProvider());
    revalidatePath(`/contracts/${contractId}/rules`);
    if (r.reused) return { ok: true, message: `Extração já realizada para este documento e versão de prompt (${r.proposals} proposta(s)); nada foi duplicado.` };
    return { ok: true, message: `${r.proposals} regra(s) proposta(s) para revisão${r.discarded ? `; ${r.discarded} item(ns) descartado(s) na validação` : ""}.` };
  });
}

export async function confirmAction(contractId: string, ruleId: string, withEdits: boolean, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  return runAction(async () => {
    await confirmRule(ctx, ruleId, withEdits ? ruleFields(fd) : undefined);
    revalidatePath(`/contracts/${contractId}/rules`);
    return { ok: true, message: "Regra confirmada. Ative-a para que participe do cálculo." };
  });
}

export async function rejectAction(contractId: string, ruleId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  return runAction(async () => {
    await rejectRule(ctx, ruleId, str(fd, "reason") ?? "");
    revalidatePath(`/contracts/${contractId}/rules`);
    return { ok: true, message: "Regra rejeitada (mantida no histórico)." };
  });
}

export async function activateAction(contractId: string, ruleId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  return runAction(async () => {
    const r = await activateRule(ctx, ruleId, str(fd, "replacesRuleId"));
    revalidatePath(`/contracts/${contractId}/rules`);
    revalidatePath(`/contracts/${contractId}`);
    const affected = r.affectedCompetences.map(formatCompetence).join(", ");
    return { ok: true, message: affected ? `Regra ativa. Competências já calculadas que precisam de reprocessamento: ${affected}.` : "Regra ativa." };
  });
}

export async function manualRuleAction(contractId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  return runAction(async () => {
    await createManualRule(ctx, { ...ruleFields(fd), contractVersionId: str(fd, "versionId"), sourceDocumentId: str(fd, "documentId") });
    revalidatePath(`/contracts/${contractId}/rules`);
    return { ok: true, message: "Regra registrada como proposta; confirme-a após conferir o trecho." };
  });
}
