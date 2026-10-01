import type { Metadata } from "next";
import Link from "next/link";
import { listImports } from "@/application/imports/imports";
import { can } from "@/application/context";
import { requireOrg } from "@/lib/session";
import { DateTime, Empty, Field, PageHeader, Section, StatusBadge, Table, Td, Th, inputCls } from "@/components/ui";
import { DirectUploadForm } from "@/components/direct-upload";
import { createUploadIntentAction, finalizeUploadAction } from "../uploads/actions";

export const metadata: Metadata = { title: "Importações" };

export default async function ImportsPage() {
  const ctx = await requireOrg();
  const imports = await listImports(ctx);
  return (
    <>
      <PageHeader title="Importações" subtitle="Arquivos de operação (horas, unidades, chamados) e de faturamento (NFs). Arquivo idêntico é detectado pelo hash." />
      {can(ctx, "imports.write") && (
        <Section title="Enviar arquivo" description="CSV (UTF-8 ou Windows-1252, separador ; , ou tab) ou XLSX, até 10 MB e 20.000 linhas.">
          <DirectUploadForm kind="IMPORT" submitLabel="Enviar" redirectToImport
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            createIntent={createUploadIntentAction} finalize={finalizeUploadAction}>
            <Field label="Tipo">
              <select name="importType" className={inputCls}>
                <option value="OPERATIONAL">Operacional (execução)</option>
                <option value="BILLING">Faturamento (NFs/faturas)</option>
              </select>
            </Field>
            <Field label="Sistema de origem (opcional)"><input name="sourceSystem" placeholder="ex.: planilha de horas, ERP" className={inputCls} /></Field>
          </DirectUploadForm>
        </Section>
      )}
      <Section title="Histórico">
        {imports.length === 0 ? <Empty title="Nenhuma importação" /> : (
          <Table>
            <thead><tr><Th>Arquivo</Th><Th>Tipo</Th><Th>Status</Th><Th right>Linhas</Th><Th right>Importadas</Th><Th right>Duplicadas</Th><Th right>Inválidas</Th><Th right>Aguardando vínculo</Th><Th>Enviado</Th></tr></thead>
            <tbody>{imports.map((i) => (
              <tr key={i.id}>
                <Td><Link className="text-brand hover:underline" href={`/imports/${i.id}`}>{i.file_name}</Link></Td>
                <Td>{i.type === "OPERATIONAL" ? "Operacional" : "Faturamento"}</Td>
                <Td><StatusBadge status={i.status} /></Td>
                <Td right>{i.row_count}</Td><Td right>{i.imported_rows}</Td><Td right>{i.duplicate_rows}</Td><Td right>{i.invalid_rows}</Td><Td right>{i.pending_match_rows}</Td>
                <Td><DateTime value={i.created_at} /><div className="text-xs text-ink-3">{i.uploader_email}</div></Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Section>
    </>
  );
}
