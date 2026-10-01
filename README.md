# Revenue Intelligence (nome provisório) — MVP 1

Camada independente de Revenue Assurance: verifica se **contrato → execução → faturamento** estão
coerentes e abre divergências auditáveis. Fonte de verdade: [`MASTER_SPEC_v1.0.md`](MASTER_SPEC_v1.0.md).

| Documento | Conteúdo |
|---|---|
| `docs/01_FIRST_TASK_ANALYSIS.md` | Análise obrigatória (produto, domínio, ERD, políticas, riscos) |
| `docs/02_IMPLEMENTATION_PLAN.md` | Estado do repositório e plano |
| `docs/DECISION_LOG.md` | ADRs |
| `docs/PHASE_REPORTS.md` | Relatórios de fase (formato PHASE_RETURN_FORMAT) |
| `BACKLOG.md` / `ROADMAP.md` | Trabalho pendente / fora do MVP |

## Arquitetura em uma linha
Next.js 16 (App Router, Server Actions) → serviços de aplicação TypeScript → Postgres (Supabase) via
conexão de servidor com `SET LOCAL ROLE authenticated` + claims do JWT (RLS ativa) ou `service_role`
(motores, após autorização). Domínio financeiro puro em `src/domain` (decimal.js, sem float).

## Rodar localmente
Pré-requisitos: Node 22, Docker, Supabase CLI.

```bash
npm install
supabase start                         # Postgres + Auth + Storage locais; aplica supabase/migrations
cp .env.example .env.local             # preencha com os valores de `supabase status -o env`
npm run seed:demo                      # opcional: demo@acme.test / DemoAcme2026
npm run dev                            # http://localhost:3000
```

Variáveis: ver `.env.example`. `DATABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são **somente servidor**.
Extração por IA: `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` (modelo em `AI_EXTRACTION_MODEL`).
Sem `AI_PROVIDER`, a extração fica desabilitada e as regras são cadastradas manualmente com trecho
do contrato. `AI_PROVIDER=deterministic-test` é um dublê de teste (regex, não é IA), bloqueado em produção.

## Testes
```bash
npm test                  # unitários (domínio: motores, invariantes, competência, normalização)
npm run test:integration  # integração contra o Postgres do Supabase local (RLS, pipeline, imports)
npm run test:e2e          # build + Playwright: cenário canônico pela interface + isolamento entre organizações
npm run typecheck
```

## Deploy (não realizado)
Vercel com Root Directory `revenue-intelligence`; `DATABASE_URL` apontando para o pooler do Supabase em
modo transação (porta 6543); aplicar migrações com `supabase db push`. Ver riscos em `docs/PHASE_REPORTS.md`
(limite de corpo de requisição da Vercel para uploads, LGPD do provedor de IA).
