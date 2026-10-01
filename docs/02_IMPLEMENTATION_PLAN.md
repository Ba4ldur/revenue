# Plano de implementação

## 1. Estado do repositório (inspeção de 2026-09-30)
| Item | Existe? | Observação |
|---|---|---|
| MASTER_SPEC_v1.0.md | Não | persistido a partir do texto fornecido |
| Código / package.json | Não | projeto criado do zero |
| Schema / migrações | Não | — |
| Testes | Não | — |
| Imagens (`*.png`, `*.jpg`) na raiz | Sim | não relacionadas ao produto; não alteradas |
| `.claude/` (skills, agent, comandos) | Sim | kit de ferramentas; não alterado |
| Ambiente | Node 22, PostgreSQL 16, Docker, Supabase CLI 2.119 | Supabase local funcional (Auth, Storage, Postgres) |

## 2. O que precisa ser criado
Tudo: app Next.js, schema, domínio, serviços, testes, seed, documentação operacional.

## 3. Estrutura
(Desde 2026-10-01 na raiz de `Ba4ldur/revenue` — ADR-031.)
```
./
  MASTER_SPEC_v1.0.md  BACKLOG.md  ROADMAP.md
  docs/                      análise, ADRs, plano, relatórios de fase
  supabase/migrations/       schema app, RLS, triggers, storage
  supabase/seed.sql          (somente engine_registry; demo via script)
  src/
    domain/                  PURO, sem I/O: money, competence, cnpj, contracts, revenue,
                             reconciliation, findings, imports (normalização), entity-resolution
    application/             casos de uso (orquestram domínio + repositórios + transação)
    repositories/            SQL parametrizado por agregado
    infrastructure/          db (scopes), storage, supabase auth, logger
    ai/                      provider abstraction, prompts versionados, validação
    jobs/                    executores idempotentes (extração, import, cálculo, reprocessamento)
    app/                     rotas Next.js (App Router) — apenas apresentação
    components/              UI
  tests/unit | tests/integration | tests/e2e
  scripts/                   seed demo, verificação
```

## 4. Ordem de execução (segue IMPLEMENTATION_ORDER)
| Bloco | Fases | Entrega verificável |
|---|---|---|
| A | 1–3 | análise, ADRs, backlog (feito) |
| B | 4, 6, 7, 8 | migrações + testes de banco (RLS cross-tenant, imutabilidade, invariantes) |
| C | 5 | Auth Supabase no Next (login, sessão, middleware) |
| D | 9–12 | clientes, contratos, versões, documentos/storage (serviço + UI + testes) |
| E | 13–14 | extração IA (provider + validação + verificação de trecho) e revisão de regras |
| F | 15–18 | imports, entity resolution, eventos operacionais e de faturamento |
| G | 19–25 | primitivas, motor, invariantes, runs, registry, reconciliação, materialidade |
| H | 26–29 | findings, evidências, workflow, reprocessamento |
| I | 30–31 | dashboard, audit UI |
| J | 32–35 | testes automatizados completos, E2E, hardening, seed demo |

**Desvio registrado (ADR-025)**: as primitivas de dinheiro/competência (Fase 19) são escritas
junto com a normalização de imports (Fase 15), porque normalizar valores exige Decimal. Isso
antecipa núcleo, não UI — respeita o espírito da ordem.

## 5. Critério de conclusão de cada fase
DEFINITION_OF_DONE do spec. Relatório no formato PHASE_RETURN_FORMAT em `docs/PHASE_REPORTS.md`.
