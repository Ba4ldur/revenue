import Link from "next/link";
import { getImport, suggestMapping } from "@/application/imports/imports";
import { listCustomers } from "@/application/customers";
import { can } from "@/application/context";
import { requireOrg } from "@/lib/session";
import { ActionForm } from "@/components/forms";
import { DateTime, Empty, KeyValue, Notice, PageHeader, Section, StatusBadge, Table, Td, Th, inputCls } from "@/components/ui";
import { MappingForm } from "./mapping-form";
import { decideMatchAction, previewAction, processAction } from "../actions";

const ROW_FILTERS: Array<[string, string]> = [["", "Todas"], ["INVALID", "Inválidas"], ["CONFLICT", "Conflitos"], ["PENDING_MATCH", "Aguardando vínculo"], ["DUPLICATE", "Duplicadas"], ["IMPORTED", "Importadas"]];
const METHOD_LABELS: Record<string, string> = { FUZZY: "nome aproximado", LEGAL_NAME_EXACT: "razão social idêntica", TRADE_NAME_EXACT: "nome fantasia idêntico", NONE: "sem candidato" };

export default async function ImportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; page?: string; dup?: string; processed?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg();
  const { import: imp, rows, pendingMatches } = await getImport(ctx, id, { rowStatus: sp.status || undefined, page: Number(sp.page ?? 0) });
  const headers = (imp.headers as string[] | null) ?? [];
  const canWrite = can(ctx, "imports.write");
  const customers = pendingMatches.length && can(ctx, "matches.decide") ? await listCustomers(ctx) : [];
  return (
    <>
      <PageHeader title={imp.file_name} subtitle={imp.type === "OPERATIONAL" ? "Importação operacional" : "Importação de faturamento"} crumbs={[{ href: "/imports", label: "Importações" }]} />
      {imp.status === "DUPLICATE" && (
        <Notice tone="warn">Arquivo idêntico (mesmo SHA-256) já importado. Nenhuma linha foi reprocessada. <Link className="underline" href={`/imports/${imp.duplicate_of_import_id}`}>Ver importação original</Link></Notice>
      )}
      {sp.processed && <Notice tone={imp.status === "COMPLETED" ? "good" : "warn"}>Processamento concluído: {imp.imported_rows} linha(s) importada(s), {imp.duplicate_rows} já existente(s), {imp.invalid_rows} inválida(s), {imp.pending_match_rows} aguardando vínculo.</Notice>}
      {imp.status === "FAILED" && <Notice tone="bad">Arquivo não pôde ser lido: {(imp.error_summary as { message?: string } | null)?.message}</Notice>}
      <Section title="Resumo">
        <KeyValue items={[
          ["Status", <StatusBadge key="s" status={imp.status} />],
          ["Linhas", String(imp.row_count)], ["Importadas", String(imp.imported_rows)], ["Duplicadas (já existentes)", String(imp.duplicate_rows)],
          ["Inválidas/conflito", String(imp.invalid_rows)], ["Aguardando vínculo", String(imp.pending_match_rows)],
          ["SHA-256", <span key="h" className="font-mono text-xs">{imp.sha256_hash}</span>], ["Enviado por", imp.uploader_email ?? "—"],
          ["Enviado em", <DateTime key="d" value={imp.created_at} />], ["Motor de normalização", imp.normalization_engine_version ?? "—"],
        ]} />
      </Section>

      {imp.status === "MAPPING_REQUIRED" && (canWrite ? (
        <Section title="Mapeamento de colunas" description="Sugestão automática a partir dos cabeçalhos — confira antes de processar.">
          <MappingForm type={imp.type} headers={headers} suggestion={suggestMapping(imp.type, headers)} preview={previewAction.bind(null, id)} process={processAction.bind(null, id)} />
        </Section>
      ) : <Notice>Aguardando mapeamento por um usuário do financeiro.</Notice>)}

      {pendingMatches.length > 0 && (
        <Section title="Vínculos de cliente pendentes" description="Só CNPJ e ID externo exatos vinculam automaticamente. Demais casos exigem decisão; linhas pendentes não geram eventos.">
          <div className="space-y-3">
            {pendingMatches.map((m) => (
              <div key={m.id} className="rounded-md border border-line p-3 text-sm">
                <p><span className="font-medium">{m.source_label}</span> <span className="text-xs text-ink-3">({m.source_key}) · {m.rows} linha(s)</span></p>
                {m.status === "PROPOSED"
                  ? <p className="mt-1">Sugestão: <strong>{m.candidate_name}</strong> — {METHOD_LABELS[m.method] ?? m.method}, confiança de vínculo {m.entity_match_confidence}</p>
                  : <p className="mt-1 text-warn">Nenhum cliente correspondente encontrado.</p>}
                {can(ctx, "matches.decide") && (
                  <div className="mt-2 flex flex-wrap items-end gap-4">
                    {m.status === "PROPOSED" && <ActionForm action={decideMatchAction.bind(null, id, m.id)} submitLabel="Confirmar sugestão" inline><input type="hidden" name="action" value="CONFIRM" /></ActionForm>}
                    {m.status === "PROPOSED" && (
                      <ActionForm action={decideMatchAction.bind(null, id, m.id)} submitLabel="Rejeitar" variant="danger" inline>
                        <input type="hidden" name="action" value="REJECT" /><input name="reason" required minLength={3} placeholder="Motivo" className={`${inputCls} w-48`} />
                      </ActionForm>
                    )}
                    <ActionForm action={decideMatchAction.bind(null, id, m.id)} submitLabel="Atribuir cliente" variant="secondary" inline>
                      <input type="hidden" name="action" value="ASSIGN" />
                      <select name="customerId" required className={`${inputCls} w-64`}>{customers.map((c) => <option key={c.id} value={c.id}>{c.legalName}</option>)}</select>
                    </ActionForm>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {imp.status !== "MAPPING_REQUIRED" && imp.status !== "DUPLICATE" && imp.status !== "FAILED" && (
        <Section title="Linhas" actions={
          <nav className="flex gap-1 text-xs">{ROW_FILTERS.map(([v, l]) => (
            <Link key={v} href={`/imports/${id}${v ? `?status=${v}` : ""}`} className={`rounded px-2 py-1 ${(sp.status ?? "") === v ? "bg-brand text-white" : "border border-line"}`}>{l}</Link>
          ))}</nav>
        }>
          {rows.length === 0 ? <Empty title="Nenhuma linha neste filtro" /> : (
            <Table>
              <thead><tr><Th>#</Th><Th>Status</Th><Th>Dados originais</Th><Th>Erro / destino</Th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <Td>{r.row_number}</Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td><code className="whitespace-pre-wrap text-xs text-ink-2">{Object.entries(r.raw_data as Record<string, unknown>).map(([k, v]) => `${k}: ${typeof v === "object" && v ? JSON.stringify(v) : String(v ?? "")}`).join(" · ")}</code></Td>
                  <Td className="text-xs">{r.error_message ?? (r.target_entity_type ? `${r.target_entity_type === "OPERATIONAL_EVENT" ? "evento operacional" : "faturamento"} ${String(r.target_entity_id).slice(0, 8)}` : "—")}</Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
          <div className="mt-3 flex gap-3 text-sm">
            {Number(sp.page ?? 0) > 0 && <Link className="text-brand" href={`/imports/${id}?status=${sp.status ?? ""}&page=${Number(sp.page) - 1}`}>← Anteriores</Link>}
            {rows.length === 100 && <Link className="text-brand" href={`/imports/${id}?status=${sp.status ?? ""}&page=${Number(sp.page ?? 0) + 1}`}>Próximas →</Link>}
          </div>
        </Section>
      )}
    </>
  );
}
