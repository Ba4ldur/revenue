"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { decideEntityMatch, previewImport, processImport } from "@/application/imports/imports";
import { invalid } from "@/application/errors";
import { parseCompetence } from "@/domain/competence";
import { MAPPABLE_FIELDS } from "@/domain/imports/normalization";
import { requireOrg } from "@/lib/session";
import { runAction, str, type ActionState } from "@/lib/actions";

function mappingFrom(fd: FormData) {
  const mapping: Record<string, string> = {};
  for (const f of MAPPABLE_FIELDS) {
    const v = str(fd, `map_${f}`);
    if (v) mapping[f] = v;
  }
  const mode = str(fd, "competenceMode") ?? "COLUMN";
  let competence: Record<string, unknown> = { mode: "COLUMN" };
  if (mode === "FIXED") {
    const c = parseCompetence(str(fd, "fixedCompetence") ?? "");
    if (!c.ok) throw invalid(`Competência fixa: ${c.error}`);
    competence = { mode: "FIXED", competence: c.value };
  } else if (mode === "FROM_DATE") {
    competence = { mode: "FROM_DATE", offsetMonths: Number(str(fd, "offsetMonths") ?? "0") };
  }
  const options = { numberFormat: str(fd, "numberFormat") ?? "BR", competence, defaultUnit: str(fd, "defaultUnit") ?? undefined, defaultEventType: str(fd, "defaultEventType") ?? undefined };
  return { mapping, options };
}

export async function previewAction(importId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  return runAction(async () => {
    const { mapping, options } = mappingFrom(fd);
    const rows = await previewImport(ctx, importId, mapping, options);
    return { ok: true, data: { rows: JSON.parse(JSON.stringify(rows)) } };
  });
}

export async function processAction(importId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  const res = await runAction(async () => {
    const { mapping, options } = mappingFrom(fd);
    await processImport(ctx, importId, mapping, options);
  });
  if (res.error) return res;
  redirect(`/imports/${importId}?processed=1`);
}

export async function decideMatchAction(importId: string, matchId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireOrg();
  return runAction(async () => {
    const action = str(fd, "action");
    const decision = action === "ASSIGN" ? { action, customerId: str(fd, "customerId"), reason: str(fd, "reason") ?? undefined }
      : action === "REJECT" ? { action, reason: str(fd, "reason") } : { action: "CONFIRM" };
    const r = await decideEntityMatch(ctx, matchId, decision);
    revalidatePath(`/imports/${importId}`);
    return { ok: true, message: action === "REJECT" ? "Vínculo rejeitado; atribua o cliente correto." : `${r.materialized} linha(s) materializada(s).` };
  });
}
