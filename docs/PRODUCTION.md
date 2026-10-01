# Configuração de produção

Checklist para subir o MVP em um ambiente real (Supabase hospedado + Vercel). Nada aqui adiciona
funcionalidade; descreve como operar o que existe com segurança.

## 1. Supabase (projeto hospedado)
1. Criar o projeto na região mais próxima dos usuários (ex.: `sa-east-1`) — dado de cliente em território
   brasileiro simplifica a análise de LGPD, mas **não é exigência automática**; confirmar com o jurídico.
2. Aplicar o schema: `supabase link --project-ref <ref>` e `supabase db push`
   (as 6 migrações criam schema `app`, RLS, triggers, buckets privados e registry de motores).
3. **Não** adicionar `app` em *API → Exposed schemas*: o navegador nunca acessa tabelas (ADR-014).
4. Auth → URL Configuration: *Site URL* = `NEXT_PUBLIC_SITE_URL`; *Redirect URLs* = `https://<domínio>/login`.
5. Auth → Providers → Email: confirmação de e-mail **ligada**; senha mínima 10 com letras maiúsculas,
   minúsculas e dígitos (espelha `supabase/config.toml`). Configurar SMTP próprio (o SMTP padrão do
   Supabase tem limite baixo de envios).
6. Storage: conferir que `contract-documents` e `imports` estão **privados**, sem políticas para
   `anon`/`authenticated` (criados pela migração; uploads chegam por URL assinada — ADR-032).
7. Backups: habilitar PITR/backup diário conforme o plano contratado. Retenção de documentos e logs
   (LGPD) é decisão do controlador — não há expurgo automático no MVP.

## 2. Variáveis de ambiente (Vercel → Project → Settings → Environment Variables)
| Variável | Escopo | Observação |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | público | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | público | chave **anon/publishable** — nunca a service role |
| `NEXT_PUBLIC_SITE_URL` | público | `https://<domínio>` |
| `SUPABASE_SERVICE_ROLE_KEY` | servidor | segredo; usado só para Storage assinado e convites |
| `DATABASE_URL` | servidor | pooler em modo transação, porta **6543** |
| `DATABASE_POOL_MAX` | servidor | 5 (por instância serverless) |
| `UPLOAD_SIGNING_SECRET` | servidor | `openssl rand -hex 32` |
| `AI_PROVIDER` | servidor | `anthropic` ou vazio |
| `ANTHROPIC_API_KEY` | servidor | segredo; nunca `NEXT_PUBLIC_` |
| `AI_EXTRACTION_MODEL` | servidor | padrão `claude-opus-5-5` |

Proibido em produção: `ALLOW_TEST_PROVIDER`, `AI_PROVIDER=deterministic-test`.

O servidor valida tudo isso no boot (`src/instrumentation.ts` → `src/lib/env.ts`): segredo com prefixo
`NEXT_PUBLIC_`, service role na chave pública, http em produção, segredo de upload curto, chave da
Anthropic ausente ou provedor de teste fora da stack local **impedem a inicialização**. Antes do deploy:
`npm run check:env -- caminho/para/arquivo.env`.

## 3. Vercel
- Projeto na raiz do repositório `Ba4ldur/revenue` (sem Root Directory customizado).
- Build: `npm run build`. Node 22.
- Uploads não passam pela função serverless (URL assinada), então o limite de corpo da plataforma não
  se aplica aos arquivos. Extração por IA e processamento de import rodam **dentro da requisição**:
  ajustar o tempo máximo de execução das funções conforme o plano (extração de contratos longos pode
  levar dezenas de segundos). Fila de jobs é débito técnico P1.

## 4. Provedor de IA (Anthropic)
- Chave criada em uma conta/workspace da organização, com limite de gasto configurado.
- **LGPD / sigilo (decisão do controlador)**: o texto do contrato é enviado ao provedor. Antes de usar
  contratos de clientes: base legal, contrato de tratamento de dados (DPA) com o fornecedor, política de
  retenção do fornecedor e aviso ao cliente. Sem isso, deixe `AI_PROVIDER` vazio e cadastre regras manualmente.
- O modelo efetivamente servido fica gravado em `rule_extraction_runs.model`.

## 5. Operação
- Logs estruturados em JSON (`event`, `org`, ids, durações); não contêm texto de contrato nem linhas de import.
- Erros mostrados ao usuário são genéricos; o detalhe técnico fica no log com `digest`.
- Objetos de upload iniciados e não finalizados ficam no bucket (intenção expira em 15 min). Limpeza
  periódica de órfãos é débito técnico (ver BACKLOG).
