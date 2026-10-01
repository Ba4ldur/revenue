"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/components/forms";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const FIELDS_COMMON: Array<[string, string]> = [
  ["cnpj", "CNPJ do cliente"], ["customer_name", "Cliente (nome)"], ["external_customer_id", "ID externo do cliente"],
  ["contract_number", "Número do contrato"], ["competence", "Competência"], ["date", "Data"], ["description", "Descrição"],
];
const FIELDS_OP: Array<[string, string]> = [["quantity", "Quantidade (horas/unidades)"], ["unit", "Unidade"], ["event_type", "Tipo de evento"], ["external_event_id", "ID externo do evento (OS/chamado)"]];
const FIELDS_BILL: Array<[string, string]> = [["amount", "Valor (bruto do serviço)"], ["document_number", "Número da NF"], ["series", "Série"], ["external_event_id", "ID externo do lançamento"]];
const UNITS: Array<[string, string]> = [["HOUR", "hora"], ["UNIT", "unidade"], ["USER", "usuário"], ["TICKET", "chamado"], ["KM", "km"], ["ITEM", "item"], ["VISIT", "visita"]];

const cls = "w-full rounded-md border border-line bg-paper px-2 py-1 text-sm";

interface PreviewRow { rowNumber: number; result: { ok: boolean; data?: Record<string, unknown>; errors?: Array<{ field: string; message: string }> } }

export function MappingForm({ type, headers, suggestion, preview, process }: {
  type: "OPERATIONAL" | "BILLING"; headers: string[]; suggestion: Record<string, string>; preview: Action; process: Action;
}) {
  const [mode, setMode] = useState("COLUMN");
  const [pState, previewAction, previewPending] = useActionState(preview, {});
  const [rState, processAction, processPending] = useActionState(process, {});
  const fields = [...FIELDS_COMMON, ...(type === "OPERATIONAL" ? FIELDS_OP : FIELDS_BILL)];
  const rows = (pState.data?.rows as PreviewRow[] | undefined) ?? [];
  return (
    <form className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {fields.map(([f, label]) => (
          <label key={f} className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
            <select name={`map_${f}`} defaultValue={suggestion[f] ?? ""} className={cls}>
              <option value="">— não mapear —</option>
              {headers.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
        ))}
      </div>
      <fieldset className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-3">
        <legend className="px-1 text-xs font-medium text-ink-2">Interpretação</legend>
        <label className="block text-sm"><span className="mb-1 block text-xs text-ink-2">Formato numérico</span>
          <select name="numberFormat" defaultValue="BR" className={cls}><option value="BR">Brasileiro (1.234,56)</option><option value="US">Internacional (1,234.56)</option></select>
        </label>
        <label className="block text-sm"><span className="mb-1 block text-xs text-ink-2">Competência</span>
          <select name="competenceMode" value={mode} onChange={(e) => setMode(e.target.value)} className={cls}>
            <option value="COLUMN">Da coluna mapeada</option>
            <option value="FIXED">Fixa para o arquivo inteiro</option>
            <option value="FROM_DATE">Mês da data − N meses</option>
          </select>
        </label>
        {mode === "FIXED" && <label className="block text-sm"><span className="mb-1 block text-xs text-ink-2">Competência fixa (MM/AAAA)</span><input name="fixedCompetence" required placeholder="09/2026" className={cls} /></label>}
        {mode === "FROM_DATE" && <label className="block text-sm"><span className="mb-1 block text-xs text-ink-2">Meses antes da data</span><input name="offsetMonths" type="number" min={0} max={12} defaultValue={type === "BILLING" ? 1 : 0} className={cls} /></label>}
        {type === "OPERATIONAL" && <>
          <label className="block text-sm"><span className="mb-1 block text-xs text-ink-2">Unidade padrão (sem coluna)</span>
            <select name="defaultUnit" defaultValue="HOUR" className={cls}>{UNITS.map(([u, l]) => <option key={u} value={u}>{l}</option>)}</select>
          </label>
          <label className="block text-sm"><span className="mb-1 block text-xs text-ink-2">Tipo de evento padrão</span><input name="defaultEventType" defaultValue="SERVICO" className={cls} /></label>
        </>}
        <p className="text-xs text-ink-3 sm:col-span-3">
          A competência nunca é deduzida em silêncio: escolha a regra explicitamente. Para faturamento emitido no mês seguinte ao serviço, use “Mês da data − 1”.
          {type === "BILLING" && " Mapeie o valor bruto do serviço (antes de retenções)."}
        </p>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button formAction={previewAction} disabled={previewPending || processPending} className="rounded-md border border-line bg-paper px-3 py-1.5 text-sm disabled:opacity-60">
          {previewPending ? "Validando…" : "Pré-visualizar 20 linhas"}
        </button>
        <ProcessButton action={processAction} pending={processPending} />
      </div>
      {pState.error && <p role="alert" className="text-sm text-bad">{pState.error}</p>}
      {rState.error && <p role="alert" className="text-sm text-bad">{rState.error}</p>}
      {rState.ok && <p role="status" className="text-sm text-good">{rState.message}</p>}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full text-xs">
            <thead><tr className="bg-canvas"><th className="px-2 py-1 text-left">Linha</th><th className="px-2 py-1 text-left">Resultado</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.rowNumber} className="border-t border-line">
                <td className="px-2 py-1 align-top">{r.rowNumber}</td>
                <td className="px-2 py-1">{r.result.ok
                  ? <code className="whitespace-pre-wrap text-ink-2">{JSON.stringify(r.result.data)}</code>
                  : <span className="text-bad">{r.result.errors?.map((e) => `${e.field}: ${e.message}`).join("; ")}</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </form>
  );
}

function ProcessButton({ action, pending }: { action: (fd: FormData) => void; pending: boolean }) {
  return (
    <button formAction={action} disabled={pending} aria-busy={pending} onClick={(e) => { if (!window.confirm("Processar todas as linhas com este mapeamento? O mapeamento fica registrado e não pode ser refeito para este arquivo.")) e.preventDefault(); }}
      className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-2 disabled:opacity-60">
      {pending ? "Processando…" : "Processar importação"}
    </button>
  );
}
