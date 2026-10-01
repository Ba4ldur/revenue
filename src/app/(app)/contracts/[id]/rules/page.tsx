import type { Metadata } from "next";
import { getContract } from "@/application/contracts";
import { getDocumentPages, listContractDocuments } from "@/application/documents";
import { listRules, type ContractRule } from "@/application/rules";
import { can } from "@/application/context";
import { RULE_TYPE_LABELS, UNIT_LABELS, MONEY_RULE_TYPES } from "@/domain/contracts/rules";
import { formatPercentFraction } from "@/domain/money/decimal";
import { getExtractionProvider } from "@/ai/factory";
import { requireOrg } from "@/lib/session";
import { ActionForm } from "@/components/forms";
import { Badge, DateBR, DateTime, Empty, Field, Money, Notice, PageHeader, Qty, Section, StatusBadge, Table, Td, Th, UnitPrice, inputCls } from "@/components/ui";
import { activateAction, confirmAction, extractAction, manualRuleAction, rejectAction } from "./actions";
import { RuleFields } from "./rule-fields";

export const metadata: Metadata = { title: "Regras do contrato" };

function RuleValue({ r }: { r: ContractRule }) {
  if (r.numericValue === null) return <span className="text-ink-2">{r.textValue}</span>;
  if (MONEY_RULE_TYPES.has(r.ruleType)) return <Money value={r.numericValue} />;
  if (r.ruleType === "EXCESS_UNIT_PRICE" || r.ruleType === "UNIT_PRICE" || r.ruleType === "ADDITIONAL_SERVICE_PRICE")
    return <><UnitPrice value={r.numericValue} />{r.unit && ` / ${UNIT_LABELS[r.unit]}`}</>;
  if (r.ruleType === "DISCOUNT_PERCENTAGE") return <span className="num">{formatPercentFraction(r.numericValue)}</span>;
  return <Qty value={r.numericValue} unit={r.unit ? UNIT_LABELS[r.unit] : null} />;
}

function Provenance({ r }: { r: ContractRule }) {
  return (
    <div className="text-xs text-ink-3">
      <div>{r.sourceDocumentName} · p. {r.sourcePage ?? "?"} · {r.sourceType === "AI_EXTRACTION" ? `IA (confiança de extração ${r.extractionConfidence ?? "—"})` : "manual"}</div>
      <blockquote className="mt-1 border-l-2 border-line pl-2 italic text-ink-2">“{r.sourceText}”</blockquote>
      {r.sourceVerified ? <Badge tone="good">Trecho verificado no documento</Badge> : <Badge tone="bad" title="O trecho não foi localizado literalmente no texto da página">Trecho não localizado — corrija antes de confirmar</Badge>}
    </div>
  );
}

export default async function RulesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg();
  const [{ contract, versions }, rules, docs] = await Promise.all([getContract(ctx, id), listRules(ctx, id), listContractDocuments(ctx, id)]);
  const reviewer = can(ctx, "rules.review");
  let aiAvailable = true;
  try { aiAvailable = getExtractionProvider() !== null; } catch { aiAvailable = false; }
  const pagesByDoc = can(ctx, "documents.download")
    ? Object.fromEntries(await Promise.all(docs.filter((d) => d.textStatus === "COMPLETED").map(async (d) => [d.id, await getDocumentPages(ctx, d.id)] as const)))
    : {};

  return (
    <>
      <PageHeader title="Regras do contrato" subtitle={`${contract.contractNumber} · ${contract.customerName}`}
        crumbs={[{ href: "/contracts", label: "Contratos" }, { href: `/contracts/${id}`, label: contract.contractNumber }]} />
      <Notice>
        Regras extraídas por IA nascem <strong>propostas</strong> e não participam do cálculo. Só depois da confirmação e ativação por um administrador
        elas passam a valer. Correções criam uma nova regra; a anterior fica preservada como substituída.
      </Notice>

      {can(ctx, "rules.propose") && (
        <Section title="Extração assistida por IA" description="A IA lê o texto extraído de cada página e propõe regras com página e trecho literal.">
          {!aiAvailable && <Notice tone="warn">Extração por IA não está configurada nesta instalação. Cadastre as regras manualmente abaixo.</Notice>}
          {docs.length === 0 ? <Empty title="Nenhum documento anexado ao contrato" /> : (
            <Table>
              <thead><tr><Th>Documento</Th><Th>Versão</Th><Th>Texto</Th><Th /></tr></thead>
              <tbody>{docs.map((d) => (
                <tr key={d.id}>
                  <Td>{d.fileName}</Td>
                  <Td>{d.contractVersionId ? `v${versions.find((v) => v.id === d.contractVersionId)?.versionNumber}` : "—"}</Td>
                  <Td><StatusBadge status={d.textStatus} label={d.textStatus === "COMPLETED" ? `${d.pageCount} página(s)` : d.textStatus === "NO_TEXT" ? "Sem texto" : d.textStatus} /></Td>
                  <Td>{aiAvailable && d.textStatus === "COMPLETED" && d.contractVersionId
                    ? <ActionForm action={extractAction.bind(null, id, d.id)} submitLabel="Extrair regras" pendingLabel="Extraindo…" variant="secondary" inline />
                    : <span className="text-xs text-ink-3">{d.contractVersionId ? "indisponível" : "vincule a uma versão"}</span>}</Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
        </Section>
      )}

      {versions.map((v) => {
        const vr = rules.filter((r) => r.contractVersionId === v.id);
        const proposed = vr.filter((r) => r.status === "PROPOSED");
        const confirmed = vr.filter((r) => r.status === "CONFIRMED");
        const active = vr.filter((r) => r.status === "ACTIVE");
        const history = vr.filter((r) => r.status === "SUPERSEDED" || r.status === "REJECTED");
        return (
          <Section key={v.id} title={`Versão v${v.versionNumber}`} description={<><DateBR value={v.validFrom} /> – {v.validUntil ? <DateBR value={v.validUntil} /> : "em aberto"} · {v.status}</>}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Aguardando revisão ({proposed.length + confirmed.length})</h3>
            {proposed.length + confirmed.length === 0 ? <p className="mb-4 text-sm text-ink-3">Nada pendente.</p> : (
              <div className="mb-6 space-y-3">
                {[...proposed, ...confirmed].map((r) => {
                  const replaceable = active.filter((a) => a.ruleType === r.ruleType && a.unit === r.unit);
                  return (
                    <div key={r.id} className="rounded-md border border-line p-3">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <StatusBadge status={r.status} label={r.status === "PROPOSED" ? "Proposta" : "Confirmada"} />
                        <span className="font-medium">{RULE_TYPE_LABELS[r.ruleType]}</span>
                        <span>· <RuleValue r={r} /></span>
                        <span className="text-xs text-ink-3">· vigência <DateBR value={r.validFrom} />{r.validUntil ? <> – <DateBR value={r.validUntil} /></> : ""}</span>
                      </div>
                      <div className="mt-2"><Provenance r={r} /></div>
                      {reviewer && r.status === "PROPOSED" && (
                        <div className="mt-3 flex flex-wrap items-start gap-4">
                          <ActionForm action={confirmAction.bind(null, id, r.id, false)} submitLabel="Confirmar como está" inline />
                          <ActionForm action={rejectAction.bind(null, id, r.id)} submitLabel="Rejeitar" variant="danger" inline>
                            <input name="reason" required minLength={3} placeholder="Motivo da rejeição" className={`${inputCls} w-64`} />
                          </ActionForm>
                          <details className="w-full">
                            <summary className="cursor-pointer text-sm text-brand">Ajustar e confirmar</summary>
                            <div className="mt-3">
                              <ActionForm action={confirmAction.bind(null, id, r.id, true)} submitLabel="Salvar ajuste e confirmar">
                                <RuleFields d={r} />
                                {r.extractedPayload ? <p className="text-xs text-ink-3">A proposta original da IA permanece registrada na regra e na auditoria.</p> : null}
                              </ActionForm>
                            </div>
                          </details>
                        </div>
                      )}
                      {reviewer && r.status === "CONFIRMED" && (
                        <div className="mt-3 flex flex-wrap gap-4">
                          <ActionForm action={activateAction.bind(null, id, r.id)} submitLabel={replaceable.length ? "Ativar substituindo a regra vigente" : "Ativar"} inline
                            confirmMessage={replaceable.length ? "A regra vigente será marcada como substituída (histórico preservado). Continuar?" : undefined}>
                            {replaceable.length > 0 && <input type="hidden" name="replacesRuleId" value={replaceable[0]!.id} />}
                          </ActionForm>
                          <ActionForm action={rejectAction.bind(null, id, r.id)} submitLabel="Rejeitar" variant="danger" inline>
                            <input name="reason" required minLength={3} placeholder="Motivo" className={`${inputCls} w-64`} />
                          </ActionForm>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Ativas ({active.length})</h3>
            {active.length === 0 ? <p className="mb-4 text-sm text-ink-3">Nenhuma regra ativa: esta versão não gera receita esperada.</p> : (
              <Table>
                <thead><tr><Th>Regra</Th><Th>Valor</Th><Th>Vigência</Th><Th>Proveniência</Th><Th>Confirmada por</Th></tr></thead>
                <tbody>{active.map((r) => (
                  <tr key={r.id}>
                    <Td className="font-medium">{RULE_TYPE_LABELS[r.ruleType]}</Td>
                    <Td><RuleValue r={r} /></Td>
                    <Td><DateBR value={r.validFrom} />{r.validUntil ? <> – <DateBR value={r.validUntil} /></> : " – em aberto"}</Td>
                    <Td><Provenance r={r} /></Td>
                    <Td className="text-xs">{r.confirmedByEmail}<br /><DateTime value={r.confirmedAt} /></Td>
                  </tr>
                ))}</tbody>
              </Table>
            )}

            {history.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm text-ink-2">Histórico ({history.length})</summary>
                <Table>
                  <thead><tr><Th>Regra</Th><Th>Valor</Th><Th>Status</Th><Th>Detalhe</Th></tr></thead>
                  <tbody>{history.map((r) => (
                    <tr key={r.id}><Td>{RULE_TYPE_LABELS[r.ruleType]}</Td><Td><RuleValue r={r} /></Td><Td><StatusBadge status={r.status} /></Td>
                      <Td className="text-xs">{r.status === "REJECTED" ? r.rejectionReason : <>substituída em <DateTime value={r.supersededAt} /></>}</Td></tr>
                  ))}</tbody>
                </Table>
              </details>
            )}
          </Section>
        );
      })}

      {can(ctx, "rules.propose") && docs.length > 0 && (
        <Section title="Cadastrar regra manualmente" description="Exige documento e trecho literal: todo valor precisa de origem.">
          <ActionForm action={manualRuleAction.bind(null, id)} submitLabel="Registrar proposta" resetOnSuccess>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Versão">
                <select name="versionId" required className={inputCls}>{versions.filter((v) => v.status === "ACTIVE").map((v) => <option key={v.id} value={v.id}>v{v.versionNumber}</option>)}</select>
              </Field>
              <Field label="Documento de origem">
                <select name="documentId" required className={inputCls}>{docs.map((d) => <option key={d.id} value={d.id}>{d.fileName}</option>)}</select>
              </Field>
            </div>
            <RuleFields />
          </ActionForm>
        </Section>
      )}

      {Object.keys(pagesByDoc).length > 0 && (
        <Section title="Texto extraído dos documentos" description="Use para conferir trechos citados. É exatamente o texto contra o qual a verificação é feita.">
          {docs.filter((d) => pagesByDoc[d.id]).map((d) => (
            <details key={d.id} className="mb-2">
              <summary className="cursor-pointer text-sm">{d.fileName}</summary>
              {pagesByDoc[d.id]!.map((p) => (
                <div key={p.pageNumber} className="mt-2 rounded border border-line bg-canvas p-2">
                  <p className="text-xs font-medium text-ink-3">Página {p.pageNumber}</p>
                  <pre className="whitespace-pre-wrap font-sans text-xs text-ink-2">{p.text}</pre>
                </div>
              ))}
            </details>
          ))}
        </Section>
      )}
    </>
  );
}
