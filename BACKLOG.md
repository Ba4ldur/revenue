# BACKLOG — MVP 1

Formato: EPIC → STORY (Título · Problema · Descrição · Critérios de aceitação · Dependências · Riscos · Prioridade) → TASKs.
Status: ☐ pendente · ◐ em andamento · ☑ concluído (conforme DEFINITION_OF_DONE; ver `docs/PHASE_REPORTS.md`).

---

## EPIC 1 — Fundação (segurança, tenancy, auditoria) · P0

### ☑ S1.1 Schema base multi-tenant com RLS · P0
- **Problema**: sem isolamento no banco, qualquer bug de aplicação vaza dados entre tenants.
- **Descrição**: schema `app`, FKs compostas, RLS em todas as tabelas, funções de papel.
- **Aceitação**: TESTE 5 passa para todas as tabelas de tenant; papel sem permissão recebe negação; nenhuma política de DELETE.
- **Dependências**: —. **Riscos**: política permissiva esquecida (mitigado por teste que varre `pg_class` exigindo RLS em todas as tabelas de `app`).
- TASKs: migração · funções `is_member/has_role` · teste de varredura de RLS · testes cross-tenant.

### ☑ S1.2 AuditLog append-only · P0
- **Aceitação**: UPDATE/DELETE em `audit_logs` falha para qualquer papel; ações sensíveis geram linha com ator, antes/depois; ADMIN/AUDITOR leem, demais não.

### ◐ S1.3 Auth + organizações + membros · P0
- **Aceitação**: login e-mail/senha (Supabase Auth); criação de organização torna o usuário ADMIN; convite de membro por e-mail; troca de organização ativa revalidada a cada requisição; sempre ≥ 1 ADMIN ativo.

### ☑ S1.4 Storage privado · P0
- **Aceitação**: upload valida extensão, MIME e magic bytes, limite de tamanho, calcula SHA-256; path sem nome do usuário; download só por signed URL de 60 s após checagem de papel; acesso direto ao bucket negado.

## EPIC 2 — Contratos · P0

### ☑ S2.1 Clientes · P0 — CNPJ normalizado e validado (DV); unique por org; soft delete.
### ☑ S2.2 Contratos e versões · P0 — vigência sem sobreposição; aditivo fecha versão anterior; histórico imutável (TESTE 14).
### ☑ S2.3 Documentos · P0 — upload PDF, extração de texto por página, status NO_TEXT para escaneados.
### ◐ S2.4 Contract Intelligence · P0
- **Aceitação**: saída da IA validada por schema; trecho verificado na página; regras nascem PROPOSED; nenhuma regra PROPOSED entra no cálculo; prompt versionado; extração idempotente por (documento, prompt, modelo).
- **Riscos**: LGPD (ADR-022), alucinação (ADR-013).
### ☑ S2.5 Revisão de regras · P0 — confirmar (com ajuste preservando payload original), rejeitar com motivo, ativar, substituir (TESTE 13).

## EPIC 3 — Imports · P0

### ☑ S3.1 Upload + hash + detecção de duplicado · P0 (TESTE 11)
### ☑ S3.2 Preview + mapeamento + opções (formato numérico, competência) · P0 (TESTE 16)
### ☑ S3.3 Validação e normalização por linha com erros visíveis · P0
### ☑ S3.4 Resolução de entidades (CNPJ → external_id → vínculo confirmado → nome → fantasia → fuzzy) · P0 (TESTE 8)
### ☑ S3.5 Persistência idempotente de OperationalEvent / BillingEvent / Invoice · P0 (TESTE 11, 17)
### S3.6 Anulação (VOIDED) de evento com motivo · P1
### S3.7 XML NFS-e/NF-e · P1 — **bloqueado**: requer schema oficial vigente e amostras (ADR-012).
### S3.8 Notas de crédito / cancelamentos · P1 — hoje valores negativos são rejeitados.

## EPIC 4 — Motor financeiro · P0

### ☑ S4.1 Primitivas Money / Quantity / Competence · P0
### ☑ S4.2 Expected Revenue Engine 1.0.0 · P0 (TESTES 1, 3, 6, 14)
### ☑ S4.3 Invariantes (código + banco) · P0 (TESTE 15)
### ☑ S4.4 CalculationRun + snapshot + hash + advisory lock · P0 (TESTES 6, 12)
### ☑ S4.5 Engine registry · P0 (TESTE 7)
### ☑ S4.6 Reconciliação 1.0.0 + materialidade · P0 (TESTES 2, 3, 4, 10)
### S4.7 REAJUSTE_NAO_APLICADO · P2 — somente após núcleo estável; exige índice oficial (IBGE/FGV) sem inventar valores.

## EPIC 5 — Findings · P0

### ☑ S5.1 Finding + evidências · P0 — cadeia completa navegável (documento/página/trecho/regra/import/linha/evento/cálculo/NF/runs).
### ☑ S5.2 Workflow de classificação · P0 (TESTE 9) — FindingAction como única via; motivo obrigatório; JUSTIFIED ≠ FALSE_POSITIVE.
### ☑ S5.3 Reprocessamento · P0 (TESTE 13) — ReprocessingJob, comparação antigo × novo, histórico preservado.

## EPIC 6 — Visões · P1 (após núcleo)

### ☑ S6.1 Dashboard executivo · P1 — 4 cards, maiores divergências, recentes, contratos de maior impacto, distribuição por tipo/status; só runs correntes.
### ☑ S6.2 Audit UI · P1 — filtro por entidade/ator/ação; ADMIN/AUDITOR.
### ☑ S6.3 Tela de contrato com versão vigente por competência · P1
### S6.4 Métricas de produto (false positive rate, tempo de classificação) · P2

## EPIC 7 — Qualidade · P0

### ☑ S7.1 Testes automatizados 1–17 · P0
### ☑ S7.2 E2E do cenário canônico (Playwright + Supabase local) · P0
### ◐ S7.3 Hardening (headers de segurança, rate limit de upload, CSP, revisão LGPD) · P1
### ☑ S7.4 Seed demo (Acme / Indústria ABC + cenários adicionais) · P1

## Débitos técnicos identificados na implementação (2026-10-01)
- ☑ P1 Upload direto para o Storage via URL assinada (ADR-032, 2026-10-01).
- ☐ P1 Revogar vínculo de cliente já MATCHED (anular eventos e permitir rematerialização).
- ☐ P1 Anular import inteiro (eventos VOIDED) e permitir nova importação do mesmo arquivo.
- ☐ P1 Fila de jobs para extração/import/reprocessamento longos (hoje síncronos na requisição).
- ☐ P1 Rate limit de upload e de ações de cálculo por organização.
- ☐ P2 Paginação/virtualização de listas (> 500 registros).
- ☐ P0 Validar a extração real com Claude em contrato real (`npm run validate:extraction`) — depende de chave no ambiente.
- ☐ P0 Conferir a regra de CNPJ alfanumérico no documento oficial da Receita Federal (acesso bloqueado no ambiente de desenvolvimento).
- ☐ P1 Confirmar com contador a política de arredondamento (ADR-003).
- ☐ P2 Limpeza periódica de objetos de upload não finalizados no Storage.

## Itens registrados fora do MVP (ver ROADMAP.md)
- Fila de jobs dedicada (pgmq/Inngest) — P2.
- OCR para PDF escaneado — P2.
- Pró-rata para troca de versão no meio do mês — P2 (exige regra financeira explícita).
- Múltiplos pools de franquia por unidade no mesmo contrato — P2.
- COBRANCA_ACIMA_DO_CONTRATADO — futuro (lista "não implementar").
