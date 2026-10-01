# Relatórios de fase (PHASE_RETURN_FORMAT)

Sessão de 2026-09-30/10-01. Fases agrupadas como no plano (`02_IMPLEMENTATION_PLAN.md`).
Ambiente de verificação: Node 22, Supabase CLI 2.119 (Postgres, Auth e Storage locais em Docker),
Chromium/Playwright 1.63.

---

## Bloco A — Fases 1–3 (Especificação, Domínio, Decision Log)
**IMPLEMENTADO**: MASTER_SPEC persistido (não existia no repo); análise da FIRST_TASK (21 itens);
30 ADRs; backlog EPIC/STORY; roadmap; plano.
**PENDENTE**: validação humana dos ADRs marcados "Requer confirmação" (003 arredondamento, 012 XML,
022 LGPD do provedor de IA).
**TESTES EXECUTADOS**: n/a (documental).
**DECISÕES TOMADAS**: ver `DECISION_LOG.md`.
**RISCOS IDENTIFICADOS**: repositório `criador-de-sites` não corresponde ao produto (ADR-000).
**DÉBITOS TÉCNICOS**: nenhum.
**PRÓXIMA ETAPA**: schema.

## Bloco B — Fases 4, 6, 7, 8 (Schema, Organizações, Membros/Permissões, RLS)
**IMPLEMENTADO**: 6 migrações no schema `app` (não exposto na Data API): 27 tabelas, FKs compostas por
`organization_id`, RLS em todas as tabelas, políticas por operação seguindo a matriz de papéis, nenhuma
política de DELETE, auditoria append-only por trigger (ator, antes/depois, intenção), triggers de
imutabilidade (regras confirmadas, versões, eventos, runs concluídos, expected revenue, findings,
evidências, ações), exclusões temporais (versões e regras ativas), invariantes financeiras no banco
(CHECK + constraint trigger diferido), máquina de estados de regras/findings/entity matches,
validação de CNPJ numérico e alfanumérico, buckets privados sem política de acesso direto, registry de motores.
**PENDENTE**: nada no escopo do bloco.
**TESTES EXECUTADOS**: `tests/integration/schema-rls.test.ts` — 23 testes, todos passando
(TESTE 5 em todas as tabelas de tenant × 5 papéis; FK composta barra referência cruzada até para
service_role; membro desativado perde acesso; append-only; último ADMIN; imutabilidade; exclusões).
**DECISÕES TOMADAS**: ADR-001, 010, 014, 015, 016, 017.
**RISCOS IDENTIFICADOS**: o servidor conecta como `postgres` e troca de papel por transação; uma consulta
fora de `withUserScope`/`withSystemScope` ignoraria RLS — mitigado por não existir API sem escopo.
**DÉBITOS TÉCNICOS**: duas migrações foram corrigidas *in place* (regex com repetição > 255 e acesso a campo
no trigger de invariante) — aceitável porque nunca foram aplicadas fora do ambiente local.
**PRÓXIMA ETAPA**: domínio financeiro.

## Bloco G — Fases 19–25 (Money, Expected Revenue Engine, Invariantes, CalculationRun, Registry, Reconciliação, Materialidade)
(antecipado em relação aos blocos C–F conforme ADR-025; é núcleo, não UI)
**IMPLEMENTADO**: `decimal.js` com rejeição de `number` em tempo de execução; competência DATE dia 1 e
parser BR estrito; `expected_revenue_engine 1.0.0` (mensalidade, franquia por unidade, excedente,
desconto fixo; NEEDS_REVIEW conservador para 10 situações ambíguas); invariantes em código;
`reconciliation_engine 1.0.0` (3 tipos do MVP, severidade, materialidade AND/OR/ABSOLUTE/PERCENTAGE);
`entity_resolution_engine 1.0.0`; `import_normalization_engine 1.0.0`.
**TESTES EXECUTADOS**: 72 unitários passando (TESTES 1, 2, 3, 4, 6, 8, 10, 14, 15, 16 + bordas: meio do
mês, atribuição ambígua, desconto maior que bruto, regra não suportada, arredondamento HALF_UP,
formato numérico BR ambíguo, CNPJ sem zeros à esquerda, varredura anti-`parseFloat` no domínio).
**DECISÕES TOMADAS**: ADR-002, 003, 004, 006, 007, 009, 011, 019, 020.
**RISCOS IDENTIFICADOS**: arredondamento sem norma verificada; um pool de franquia por unidade.
**DÉBITOS TÉCNICOS**: pró-rata e múltiplos pools (backlog P2).
**PRÓXIMA ETAPA**: camada de aplicação.

## Blocos C–F, H — Fases 5, 9–18, 26–29 (Auth, Clientes, Contratos, Versões, Documentos, Contract Intelligence, Revisão, Imports, Entity Resolution, Eventos, Findings, Evidências, Workflow, Reprocessamento)
**IMPLEMENTADO**: serviços com escopo explícito; upload PDF com validação de extensão/MIME/magic
bytes/tamanho, SHA-256, path sem nome do usuário, texto por página (pdf.js); extração por IA via
abstração de provedor (Anthropic `messages.parse` + Zod) com validação determinística e verificação
literal do trecho no banco; revisão (confirmar, ajustar e confirmar preservando o payload da IA,
rejeitar com motivo, ativar, substituir); aditivo com cópia das regras como propostas; imports CSV/XLSX
(encoding, delimitador, limites), duplicado por hash, mapeamento + opções explícitas de competência e
formato numérico, normalização, deduplicação por `dedup_key`, resolução de cliente com decisão humana,
NF conflitante; pipeline transacional com advisory lock, snapshot + hash, reutilização idempotente,
substituição versionada, run FAILED registrado mesmo quando a invariante falha no commit; finding OPEN com
cadeia de evidências e métricas de confiança separadas; FindingAction como única via de classificação;
reprocessamento com comparação antigo × novo.
**PENDENTE**: convite de membro não foi exercitado de ponta a ponta (depende do e-mail do Supabase Auth);
extração com Claude real **não executada** (sem credencial no ambiente) — só o dublê determinístico.
**TESTES EXECUTADOS**: `tests/integration/pipeline.test.ts` — 16 testes passando: cenário canônico
completo (PDF real → extração → revisão → imports → R$ 22.760 → finding R$ 4.760 com evidências,
completude 1.0000), TESTES 4, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17 e permissões verticais.
**DECISÕES TOMADAS**: ADR-008, 013, 018, 021, 022, 023/026, 030.
**RISCOS IDENTIFICADOS**: limite de corpo de requisição da Vercel (uploads grandes); jobs síncronos.
**DÉBITOS TÉCNICOS**: revogar match já confirmado; anular import inteiro; fila de jobs.
**PRÓXIMA ETAPA**: interface.

## Bloco I — Fases 30–31 (Dashboard, Audit UI) + rotas do MVP
**IMPLEMENTADO**: todas as rotas de `<MVP_ROUTES>` mais `/onboarding`, download de documento e logout;
estados de carregamento (`loading.tsx`), vazio e erro em todas as telas; avisos persistentes após
transições; painel só com runs correntes e números navegáveis; tela de divergência com as 12 seções do
FINDING_SCREEN; materialidade com explicação AND/OR; auditoria com filtro e diff de campos.
**PENDENTE**: responsividade abaixo de ~1024 px não foi otimizada (barra lateral fixa).
**TESTES EXECUTADOS**: `next build` sem erros; revisão visual por screenshots (divergência, painel).
**DECISÕES TOMADAS**: ADR-027, 028.
**RISCOS IDENTIFICADOS**: nenhum novo.
**DÉBITOS TÉCNICOS**: paginação de listas grandes.
**PRÓXIMA ETAPA**: E2E e hardening.

## Bloco J — Fases 32–35 (Testes automatizados, E2E, Hardening, Seed)
**IMPLEMENTADO**: suíte completa; E2E Playwright contra Next em modo produção + Supabase local real;
cabeçalhos de segurança (CSP restrita, X-Frame-Options, nosniff, Referrer/Permissions-Policy, HSTS em
produção), `poweredByHeader` desligado, mensagem de login genérica, política de senha (10+ caracteres,
maiúsculas/minúsculas/dígitos no Auth local); seed de demonstração com os 7 cenários do SEED_DATA.
**PENDENTE**: rate limiting próprio da aplicação; revisão LGPD formal; backups/retenção (configuração do
projeto Supabase, fora do código).
**TESTES EXECUTADOS**: 72 unitários + 39 integração = **111 passando**; E2E **1/1 passando** (fluxo
canônico completo pela interface + TESTE 5 pela interface com segunda organização); `npm audit --omit=dev`
sem vulnerabilidades (override de `uuid` para corrigir aviso do exceljs).
**DECISÕES TOMADAS**: ADR-029.
**RISCOS IDENTIFICADOS**: `ALLOW_TEST_PROVIDER=1` libera o dublê em produção — usado só no E2E local; não
configurar em ambientes reais.
**DÉBITOS TÉCNICOS**: ver `BACKLOG.md` → "Débitos técnicos identificados".
**PRÓXIMA ETAPA**: validação com contratos e exportações reais (MVP 0/concierge) e extração com Claude real.

---

## Etapa de preparação para validação real (2026-10-01, repositório `Ba4ldur/revenue`)
**IMPLEMENTADO**: upload direto ao Storage por URL assinada com intenção HMAC e revalidação do conteúdo
(ADR-032); validação de ambiente no boot e `check:env` (ADR-033); provedor de teste restrito à stack local
(ADR-034); rejeição de precisão excessiva em entradas (ADR-035); fronteira de erro global; script
`validate:extraction` para testar o provedor real em PDF real sem gravar; ponto de injeção de `fetch` no
provider Anthropic (somente testes); docs `PRODUCTION.md`, `VALIDATION_RUNBOOK.md`, `FINANCIAL_POLICIES.md`.
**PENDENTE**: extração com Claude real (sem `ANTHROPIC_API_KEY` no ambiente); leitura do documento oficial do
CNPJ alfanumérico (gov.br bloqueado pela rede do ambiente); confirmação contábil do arredondamento.
**TESTES EXECUTADOS**: typecheck; 85 unitários; 46 integração (inclui 7 de upload assinado contra o Storage
real); build; E2E 1/1 (upload direto pela interface); boot recusado com provedor de teste não autorizado.
**DECISÕES TOMADAS**: ADR-032 a 035.
**RISCOS IDENTIFICADOS**: extração e processamento de import síncronos na requisição (tempo máximo da
função); objetos órfãos de uploads abandonados; cláusulas contratuais de arredondamento de quantidade não
suportadas pelo motor.
**DÉBITOS TÉCNICOS**: ver BACKLOG (limpeza de órfãos, fila de jobs, revogar match, anular import).
**PRÓXIMA ETAPA**: teste real ponta a ponta conforme `VALIDATION_RUNBOOK.md`.
