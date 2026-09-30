# Decision Log (ADR)

Formato: ID · Título · Problema · Decisão · Justificativa · Alternativas · Consequências · Data · Status.
Todas com data 2026-09-30 e status **Aceita** salvo indicação. Decisões marcadas
"Requer confirmação" dependem de validação humana (contador, jurídico ou dono do produto).

---

### ADR-000 · Localização do projeto
- **Problema**: o repositório `criador-de-sites` contém apenas imagens e um kit `.claude`; não há
  `MASTER_SPEC_v1.0.md` nem código do produto.
- **Decisão**: criar o produto em `revenue-intelligence/` e persistir o spec ali.
- **Justificativa**: não misturar com ativos não relacionados; não apagar nada existente.
- **Alternativas**: raiz do repo (mistura artefatos); novo repo (fora do escopo de acesso desta sessão).
- **Consequências**: deploy na Vercel com Root Directory = `revenue-intelligence`. Recomenda-se
  repositório próprio.

### ADR-001 · Multi-tenancy: shared schema + organization_id + RLS + FKs compostas
- **Problema**: isolar tenants sem custo operacional de banco por cliente.
- **Decisão**: banco e schema compartilhados; `organization_id NOT NULL` em toda tabela de tenant;
  `UNIQUE (organization_id, id)` em toda tabela pai; FKs `(organization_id, x_id)`; RLS em todas.
- **Justificativa**: exigido pelo spec; FKs compostas tornam referência cross-tenant impossível
  mesmo quando o código roda com privilégio de sistema.
- **Alternativas**: schema por tenant (migrações N×), banco por tenant (custo).
- **Consequências**: índices compostos; toda query de sistema precisa de `organization_id`.

### ADR-002 · Precisão monetária
- **Decisão**: `numeric(18,2)` dinheiro; `numeric(18,6)` quantidade e preço unitário;
  `numeric(12,8)` percentual (fração); `numeric(18,10)` fator; `decimal.js` na aplicação; `numeric`
  trafega como string (driver sem conversão para `number`).
- **Justificativa**: MONETARY_POLICY; float gera erro binário.
- **Alternativas**: inteiros em centavos (perde escala de preço unitário de 6 casas).
- **Consequências**: nenhum `parseFloat/Number()` em domínio (verificado por teste).

### ADR-003 · Arredondamento — **Requer confirmação (contador)**
- **Decisão**: ROUND_HALF_UP, escala 2, somente no valor final de cada componente monetário.
  Quantidades/excedentes sem arredondamento. Totais = soma exata de componentes.
- **Justificativa**: arredondamento comercial usual; arredondar só uma vez evita acúmulo.
- **Alternativas**: HALF_EVEN (bancário); arredondar só o total.
- **Consequências**: mudança exige nova versão do `expected_revenue_engine`. Não verifiquei norma
  oficial aplicável; confirmar com profissional habilitado.

### ADR-004 · Competência
- **Decisão**: `DATE` no dia 1 com `CHECK`; tipo `Competence` no domínio; parser BR estrito
  (DD/MM, nunca MM/DD).
- **Consequências**: competências não mensais exigirão modelagem nova (fora do MVP).

### ADR-005 · Versionamento de contrato
- **Decisão**: versões com vigência `[valid_from, valid_until]`; exclusão temporal (btree_gist)
  entre ACTIVE; após ACTIVE só é permitido fechar `valid_until` ou marcar SUPERSEDED; regras
  pertencem à versão e são imutáveis após confirmação; correção = nova regra/versão.
- **Consequências**: troca de versão no meio do mês → NEEDS_REVIEW (sem pró-rata no 1.0.0).

### ADR-006 · CalculationRun em dois estágios
- **Problema**: o spec pede versão de motor por run, mas há dois motores financeiros
  (expected revenue e reconciliação).
- **Decisão**: run `EXPECTED_REVENUE` (pai) e run `RECONCILIATION` (filho, `parent_run_id`); cada um
  com seu motor/versão; snapshot canônico + hash; um único run COMPLETED por (tipo, escopo,
  competência) via índice único parcial; substituição por SUPERSEDED.
- **Justificativa**: mudança de materialidade reprocessa só a reconciliação; cada finding aponta
  o run e a versão exata que o gerou.
- **Alternativas**: run único com várias versões em JSON (perde FK para o registry).

### ADR-007 · Registro de versões de motor
- **Decisão**: tabela `engine_registry` com PK `(engine_name, engine_version)` e FK a partir de
  `calculation_runs`; constantes versionadas no código; prompts de extração também registrados.

### ADR-008 · Idempotência
- **Decisão**: SHA-256 de arquivo; `dedup_key` por evento (`ext:` / `doc:` / `row:<hash>:<ocorrência>`);
  hash de snapshot em runs; chave de idempotência em extrações e reprocessamentos; transações com
  advisory lock.
- **Justificativa**: o índice de ocorrência preserva linhas legitimamente idênticas dentro do mesmo
  arquivo e impede duplicação na reimportação.
- **Consequências**: se um sistema exporta a mesma linha em dois arquivos *diferentes* com
  intenção de representar dois fatos distintos sem `external_id`, eles serão deduplicados
  (falso negativo, nunca falso positivo). Recomendar mapeamento de `external_event_id`.

### ADR-009 · Tipos de regra do motor 1.0.0
- **Decisão**: suportar FIXED_MONTHLY_FEE, INCLUDED_QUANTITY, EXCESS_UNIT_PRICE, DISCOUNT_FIXED;
  demais tipos monetários ACTIVE bloqueiam o cálculo (NEEDS_REVIEW); tipos informativos não afetam
  cálculo. Pareamento franquia/preço por `unit`; um pool por unidade por versão.
- **Justificativa**: ignorar silenciosamente uma regra monetária ativa geraria finding errado.

### ADR-010 · RLS
- **Decisão**: funções `SECURITY DEFINER` (`is_member`, `has_role`), políticas por operação,
  nenhuma política de DELETE, tabelas de saída de motor sem escrita para `authenticated`,
  `finding_actions` como única via de mudança de status, audit log só por trigger.

### ADR-011 · Competência do faturamento
- **Problema**: NF de serviços do mês M frequentemente emitida em M+1; inferir errado cria falso
  positivo "cliente sem faturamento".
- **Decisão**: competência vem de coluna mapeada **ou** de regra explícita escolhida no import
  (`FIXED` = competência única do arquivo; `FROM_DATE_OFFSET` = mês da data de emissão − N meses).
  A regra fica gravada em `imports.parse_options` e na linha normalizada.
- **Alternativas**: inferir pela data de emissão (rejeitada: silenciosa).

### ADR-012 · XML de faturamento adiado — **Requer amostras/schema oficial**
- **Decisão**: MVP aceita CSV/XLSX para faturamento; XML (NFS-e/NF-e) só após obter schema oficial
  vigente e amostras reais do cliente.
- **Justificativa**: "NÃO inventar dado fiscal"; layouts variam (ABRASF, Padrão Nacional, municipais).

### ADR-013 · Verificação de proveniência da IA
- **Decisão**: o trecho citado pela IA precisa existir (após normalização de espaços/caixa) no
  texto extraído da página citada; caso contrário `source_verified = false` e a confirmação é
  bloqueada até o revisor fornecer trecho válido. Valores numéricos da IA chegam como string e são
  validados por schema (zod) antes de virar proposta.

### ADR-014 · Acesso ao banco somente pelo servidor
- **Decisão**: tabelas no schema `app`, não exposto na Data API; servidor Next.js acessa via
  Postgres (pooler em modo transação) com `SET LOCAL ROLE` + `request.jwt.claims` do JWT verificado
  pelo Supabase Auth. Motores usam `service_role` após checagem de autorização.
- **Justificativa**: transações reais (necessárias para runs atômicos), superfície de ataque
  menor (sem PostgREST sobre tabelas financeiras), RLS preservado como defesa em profundidade e
  testável em Postgres puro.
- **Alternativas**: supabase-js + PostgREST + RPC (sem transações multi-passo no cliente).
- **Consequências**: `DATABASE_URL` é segredo de servidor; nunca `NEXT_PUBLIC_`.

### ADR-015 · Matriz de permissões
- **Decisão**: conforme `01_FIRST_TASK_ANALYSIS.md §3.2`; só ADMIN confirma/ativa regras.

### ADR-016 · Estado NEEDS_REVIEW em Import
- **Decisão**: import com linhas aguardando decisão de entity match fica `NEEDS_REVIEW`; linhas
  pendentes não geram eventos até decisão humana.
- **Justificativa**: ERROR_HANDLING cita NEEDS_REVIEW; nenhum dos estados do spec representa "à espera
  de humano" sem ser erro.

### ADR-017 · Correção de eventos por anulação (VOIDED)
- **Decisão**: OperationalEvent/BillingEvent são imutáveis; correção = marcar VOIDED (motivo,
  autor) e criar novo evento. Motor usa só ACTIVE. `dedup_key` único apenas entre ACTIVE.
- **Justificativa**: histórico nunca sobrescrito; runs antigos continuam explicáveis via snapshot.

### ADR-018 · Reprocessamento e classificação humana
- **Decisão**: findings de runs novos nascem OPEN com `previous_finding_id`; classificação anterior
  exibida mas não copiada; runs FAILED não substituem o corrente.
- **Justificativa**: DETECTION_VS_CLASSIFICATION proíbe o motor de gerar CONFIRMED etc.

### ADR-019 · Classificação do tipo de finding (reconciliation_engine 1.0.0)
- **Decisão** (somente quando `difference > 0` e materialidade atingida):
  1. `billed = 0` → CLIENTE_ATIVO_SEM_FATURAMENTO;
  2. `variable > 0` e `billed ≥ base − discount + adjustment` → CONSUMO_EXCEDENTE_NAO_FATURADO;
  3. demais → COBRANCA_ABAIXO_DO_CONTRATO.
  `difference < 0` → sem finding no MVP (registrado no summary). Faturamento sem vínculo de contrato
  para cliente com mais de um contrato na competência → NEEDS_REVIEW.
- **Severidade**: por `difference / expected`: < 5% LOW, < 15% MEDIUM, < 50% HIGH, ≥ 50% CRITICAL.
  Parte da versão do motor.

### ADR-020 · Materialidade
- **Decisão**: `materiality_policies` versionada (uma ACTIVE por org); percentual como fração de
  `expected_total`; comparação `≥`; padrão inicial COMBINED R$ 500 **AND** 1% (conservador: menos
  alertas de baixa utilidade). A política usada entra no snapshot do run de reconciliação.
- **Consequências**: mudança de política → reprocessamento só da reconciliação.

### ADR-021 · Jobs
- **Decisão**: sem fila externa no MVP. Cada processo assíncrono tem entidade própria com estado
  (RuleExtractionRun, Import, CalculationRun, ReprocessingJob), chave de idempotência e execução
  transacional; disparo síncrono pelo servidor com `maxDuration` adequado.
- **Alternativas**: pgmq / Supabase Queues / Inngest (backlog P2, quando volume exigir).

### ADR-022 · Provedor de IA
- **Decisão**: interface `ContractExtractionProvider`; implementação Anthropic (modelo configurável
  por env) e implementação determinística de teste. Prompt versionado no `engine_registry`.
- **LGPD — Requer confirmação**: envio de contratos a provedor externo é tratamento de dados por
  operador; exige base legal, DPA e aviso ao cliente. Extração fica desabilitada se
  `AI_PROVIDER` não estiver configurado (sem fallback silencioso).

### ADR-023 · Storage
- **Decisão**: buckets privados `contract-documents` e `imports`; path `{org}/{uuid}.{ext}`; sem
  políticas para usuários em `storage.objects` (deny-all); upload e signed URL (60 s) via servidor
  após autorização; validação de extensão, MIME declarado **e** magic bytes, limite de tamanho,
  SHA-256. Implementação local em disco apenas para desenvolvimento/teste (bloqueada em produção).

### ADR-024 · Falso positivo × justificado
- **Decisão**: estados distintos com ações distintas (MARK_FALSE_POSITIVE × JUSTIFY), motivo
  obrigatório em ambos, métricas separadas (false positive rate não conta JUSTIFIED).

### ADR-025 · Primitivas financeiras antes dos imports
- **Problema**: IMPLEMENTATION_ORDER coloca Money primitives (19) depois de Imports (15), mas a
  normalização de valores importados exige Decimal.
- **Decisão**: implementar `domain/money` e `domain/competence` junto da Fase 15.
- **Consequências**: nenhuma; antecipa núcleo, não UI.
