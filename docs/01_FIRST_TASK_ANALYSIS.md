# FIRST_TASK — Análise do MASTER_SPEC v1.0

Data: 2026-09-30 · Autor: Claude Code (sessão de implementação) · Status: base para Fases 1–4

Este documento cumpre os itens 1–21 da `<FIRST_TASK>`. Onde o spec é omisso ou ambíguo,
a decisão tomada está marcada com **[ADR-xxx]** e detalhada em `DECISION_LOG.md`.
Fatos (o que o spec diz), inferências (o que decorre dele) e decisões (o que eu escolhi)
estão separados explicitamente.

---

## 1. Leitura integral

O MASTER_SPEC v1.0 foi lido integralmente. Ele **não existia** no repositório; foi
persistido em `revenue-intelligence/MASTER_SPEC_v1.0.md` a partir do texto fornecido.

Constatação sobre o repositório (fato): `ba4ldur/criador-de-sites` contém apenas 20 imagens
(fotos de estética automotiva / imagens geradas) e um kit `.claude` de skills. Não há
código, schema, nem documentação do produto. O nome do repositório não corresponde ao
produto. **[ADR-000]**: o produto é isolado no subdiretório `revenue-intelligence/` para não
misturar com os ativos existentes. Recomendação: mover para repositório próprio antes de
qualquer deploy (Vercel suporta "Root Directory", então o subdiretório não bloqueia).

---

## 2. Resumo executivo

- **O que é**: camada independente de Revenue Assurance que responde, por contrato e
  competência, "quanto deveria ter sido faturado?" e compara com o faturado, gerando
  *findings* auditáveis. Não é ERP, billing, CRM nem sistema fiscal.
- **O que o MVP 1 prova**: CONTRATADO → EXECUTADO → FATURADO. RECEBIDO é futuro.
- **Ativo central**: motor determinístico de Expected Revenue + reconciliação com memória de
  cálculo, versão de motor e cadeia de evidências.
- **Regra inegociável**: IA só propõe regras; humano confirma e ativa; código calcula.
  Nenhum valor monetário sai de LLM.
- **Critério de pronto**: o cenário canônico (R$ 18.000 + 17h × R$ 280 = R$ 22.760 esperado,
  R$ 18.000 faturado, finding OPEN de R$ 4.760) funcionando ponta a ponta com RLS,
  auditoria e reprodutibilidade.
- **Prioridades em conflito**: Segurança/Tenancy > Integridade de dados > Escopo do MVP >
  Regras financeiras > Auditabilidade > Domínio > Ordem > UX > Roadmap.

Avaliação crítica da tese (opinião fundamentada):
1. A tese é boa porque o valor é mensurável (R$ encontrados). O risco é a **qualidade das
   fontes**: exportações de horas e de faturamento sem CNPJ/contrato tornam a atribuição
   ambígua. O produto precisa ser conservador (não gerar finding) quando a atribuição é
   ambígua — isso reduz alertas, mas protege a confiança, que é o ativo comercial.
2. O maior risco de falso positivo não é o cálculo, é o **casamento de faturamento com
   competência**: muitas empresas emitem a NF do mês M no mês M+1. O spec não define como a
   competência do faturamento é obtida. **[ADR-011]**: competência de faturamento nunca é
   inferida silenciosamente; ou vem de coluna mapeada, ou o usuário escolhe explicitamente
   a regra (competência fixa do arquivo ou "mês da emissão − N"), e isso fica gravado no
   mapping do import.
3. Cobrança **acima** do contrato não é finding no MVP (fato: está na lista "não
   implementar"). Consequência: o motor registra a diferença negativa na memória da
   reconciliação, mas não abre finding. Isso é transparente no `result_summary`.
4. XML de NFS-e: layouts variam por município/padrão (ABRASF, Padrão Nacional). Implementar
   parser sem amostras e schema oficial verificado violaria "NÃO inventar dado fiscal".
   **[ADR-012]**: MVP aceita CSV/XLSX para faturamento; XML fica bloqueado até haver schema
   oficial e amostras reais (item de backlog P1).

---

## 3. Product Specification (MVP 1)

### 3.1 Personas e papéis
| Papel | Responsabilidade no MVP |
|---|---|
| ADMIN | Configura organização, membros, materialidade; confirma/ativa regras; tudo |
| FINANCE | Importa operação e faturamento; resolve matches; roda cálculo; classifica findings |
| COMMERCIAL | Clientes, contratos, versões, documentos; dispara extração; lê regras |
| AUDITOR | Leitura ampla, evidências, auditoria; pode iniciar revisão e anotar findings |
| EXECUTIVE | Dashboard e leitura de findings |

### 3.2 Matriz de permissões (menor privilégio) **[ADR-015]**
| Recurso / ação | ADMIN | FINANCE | COMMERCIAL | AUDITOR | EXECUTIVE |
|---|:-:|:-:|:-:|:-:|:-:|
| Ler organização / clientes / contratos / versões | ✔ | ✔ | ✔ | ✔ | ✔ |
| Criar/editar clientes, contratos, versões | ✔ | – | ✔ | – | – |
| Upload de documento de contrato / disparar extração | ✔ | – | ✔ | – | – |
| Baixar documento (signed URL) | ✔ | ✔ | ✔ | ✔ | – |
| Ler regras | ✔ | ✔ | ✔ | ✔ | ✔ |
| Confirmar / rejeitar / ativar / substituir regra | ✔ | – | – | – | – |
| Criar import (operacional/faturamento) | ✔ | ✔ | – | – | – |
| Ler imports, linhas, eventos | ✔ | ✔ | – | ✔ | – |
| Decidir entity match | ✔ | ✔ | – | – | – |
| Disparar cálculo / reprocessamento | ✔ | ✔ | – | – | – |
| Ler CalculationRun / Expected Revenue / findings / evidências | ✔ | ✔ | ✔ (leitura) | ✔ | ✔ |
| Classificar finding (confirmar, justificar, FP, descartar, recuperar) | ✔ | ✔ | – | – | – |
| Iniciar revisão / anotar finding | ✔ | ✔ | – | ✔ | – |
| Materialidade (editar) | ✔ | – | – | – | – |
| Membros (gerenciar) | ✔ | – | – | – | – |
| AuditLog (ler) | ✔ | – | – | ✔ | – |

Inferência discutível: o spec dá a COMMERCIAL só "consulta de regras" e a FINANCE nada sobre
regras. Logo, **só ADMIN confirma/ativa regras**. Isso é restritivo em empresas pequenas
(o ADMIN vira gargalo), mas é a leitura literal e mais segura.

### 3.3 Fluxos funcionais do MVP
1. **Onboarding**: login (Supabase Auth, e-mail+senha) → se sem vínculo, cria organização
   (usuário vira ADMIN; política de materialidade padrão é criada) → convida membros.
2. **Cadastro**: cliente (CNPJ normalizado e validado por dígito verificador) → contrato →
   versão 1 (vigência) → upload do PDF (privado, hash, MIME/magic bytes, tamanho).
3. **Contract Intelligence**: extração de texto por página → LLM (prompt versionado) →
   saída validada por schema → regras PROPOSED com página, trecho e confiança. O servidor
   verifica se o trecho citado existe literalmente no texto da página (**[ADR-013]**); se
   não existir, a regra fica marcada `source_verified = false` e não pode ser confirmada.
4. **Revisão**: ADMIN confirma (com ou sem ajuste — o payload original da IA é preservado),
   rejeita (com motivo) e ativa. Só regras ACTIVE entram no motor.
5. **Imports**: upload CSV/XLSX → hash (arquivo idêntico = DUPLICATE) → parse → preview →
   mapeamento de colunas + opções (formato numérico BR/US, regra de competência) →
   validação/normalização linha a linha → resolução de cliente → persistência idempotente
   de OperationalEvent/BillingEvent. Linhas com match PROPOSED/UNMATCHED ficam
   `PENDING_MATCH` e **não** geram eventos até decisão humana.
6. **Cálculo**: por contrato × competência → CalculationRun (Expected Revenue) →
   ExpectedRevenueEvent + componentes → invariantes → CalculationRun (Reconciliação, filho)
   → materialidade → Finding OPEN com evidências (ou "sem finding", também registrado).
7. **Workflow**: finding OPEN → UNDER_REVIEW → CONFIRMED/JUSTIFIED/FALSE_POSITIVE/DISCARDED
   → (CONFIRMED) RECOVERED. Toda transição = FindingAction + AuditLog.
8. **Reprocessamento**: mudança (regra corrigida, match alterado, evento anulado,
   materialidade, versão de motor) → ReprocessingJob → novos runs → comparação antigo/novo;
   runs antigos ficam SUPERSEDED, nunca apagados.
9. **Dashboard / Auditoria**: indicadores só a partir de runs correntes; todo número é
   clicável até a origem.

### 3.4 Fora do escopo (confirmado)
Integrações (Omie, Conta Azul, Bling, Asaas, bancos, Open Finance), recebimentos,
cobrança, boleto, emissão fiscal, pagamento, chatbot/copiloto, Margin Assurance, ações em
sistemas externos, CRM, propostas, estoque, contas a pagar, workflow genérico,
REAJUSTE_NAO_APLICADO (opcional só após núcleo estável), demais tipos de finding.

---

## 4. Domain Model

Convenções globais **[ADR-001]**: todas as tabelas de tenant ficam no schema `app`, têm
`organization_id NOT NULL`, `UNIQUE (organization_id, id)` e **FKs compostas**
`(organization_id, x_id) → pai(organization_id, id)`. Isso torna referência cross-tenant
impossível no nível do banco, mesmo em código com privilégio de sistema.
Timestamps em `timestamptz`; ids `uuid` (`gen_random_uuid()`).

| Entidade | Responsabilidade | Estados | Mutabilidade / soft delete | Auditoria |
|---|---|---|---|---|
| Organization | Tenant | ACTIVE, SUSPENDED | soft delete | trigger |
| User (`app.users`) | Perfil espelho de `auth.users` | – | – | trigger |
| OrganizationUser | Vínculo + papel | INVITED, ACTIVE, DISABLED | sem delete (desativa) | trigger |
| Customer | Cliente do tenant | ACTIVE, INACTIVE | soft delete | trigger |
| Contract | Relação comercial | DRAFT, ACTIVE, SUSPENDED, TERMINATED | soft delete | trigger |
| ContractVersion | Vigência temporal das regras | DRAFT, ACTIVE, SUPERSEDED | após ACTIVE só fecha `valid_until` ou SUPERSEDED | trigger |
| ContractDocument | Arquivo privado | extração: PENDING, COMPLETED, FAILED, NO_TEXT | soft delete; arquivo nunca apagado se referenciado | trigger |
| ContractDocumentPage | Texto por página (provenance) | – | imutável | – |
| RuleExtractionRun | Job de extração IA | PENDING, RUNNING, COMPLETED, FAILED, CANCELLED | imutável após término | trigger |
| ContractRule | Regra contratual temporal | PROPOSED, CONFIRMED, ACTIVE, SUPERSEDED, REJECTED | valores imutáveis após CONFIRMED | trigger |
| Import | Arquivo importado | UPLOADED, MAPPING_REQUIRED, VALIDATING, PROCESSING, NEEDS_REVIEW*, COMPLETED, COMPLETED_WITH_ERRORS, FAILED, DUPLICATE | – | trigger |
| ImportRow | Linha bruta + normalizada | PENDING, VALID, INVALID, PENDING_MATCH, IMPORTED, DUPLICATE, CONFLICT | – | (volume: não auditado por linha) |
| EntityMatch | Decisão de resolução | MATCHED, PROPOSED, UNMATCHED, REJECTED | nova decisão = nova linha/atualização auditada | trigger |
| OperationalEvent | Fato operacional | ACTIVE, VOIDED* | imutável; correção = VOIDED + novo | trigger |
| Invoice | Documento fiscal agregador | – | imutável | trigger |
| BillingEvent | Fato faturado | ACTIVE, VOIDED* | imutável; correção = VOIDED + novo | trigger |
| EngineRegistry | Versões de motores/prompts | – | append-only | – |
| CalculationRun | Execução reprodutível | PENDING, RUNNING, COMPLETED, FAILED, SUPERSEDED | imutável após término (só → SUPERSEDED) | trigger |
| ExpectedRevenueEvent | Resultado "deveria faturar" | – | imutável | – |
| ExpectedRevenueComponent (+ Sources) | Memória de cálculo por parcela | – | imutável | – |
| MaterialityPolicy | Limiar por organização (versionado) | ACTIVE, SUPERSEDED | nova versão por mudança | trigger |
| Finding | Divergência detectada | OPEN, UNDER_REVIEW, CONFIRMED, JUSTIFIED, FALSE_POSITIVE, DISCARDED, RECOVERED | valores imutáveis; status só via FindingAction | trigger |
| FindingEvidence | Elo da cadeia de prova | – | imutável, FKs RESTRICT | – |
| FindingAction | Ação humana | – | append-only | trigger |
| ReprocessingJob | Reprocessamento intencional | PENDING, RUNNING, COMPLETED, FAILED, CANCELLED | – | trigger |
| AuditLog | Trilha append-only | – | append-only (trigger + grants) | – |

`*` = extensão ao spec, justificada em ADR (NEEDS_REVIEW em Import: **[ADR-016]**;
VOIDED em eventos: **[ADR-017]**).

Entidades futuras (não criadas): Receivable, Payment, Connector, SyncRun, BankTransaction,
RevenueAdjustment, MarginAnalysis.

### 4.1 Tipos de regra suportados **[ADR-009]**
| rule_type | Semântica | Campos | Motor 1.0.0 |
|---|---|---|---|
| FIXED_MONTHLY_FEE | Mensalidade | numeric_value (R$, 2 casas) | calcula BASE |
| INCLUDED_QUANTITY | Franquia | numeric_value (qtd), unit | usa no EXCESS |
| EXCESS_UNIT_PRICE | Preço do excedente | numeric_value (R$/unid, 6 casas), unit | calcula EXCESS |
| DISCOUNT_FIXED | Desconto autorizado fixo | numeric_value (R$, 2 casas) | calcula DISCOUNT |
| DISCOUNT_PERCENTAGE, PRICE_ADJUSTMENT, ADDITIONAL_SERVICE_PRICE, UNIT_PRICE | Monetárias não suportadas | – | se ACTIVE → run FAILED/NEEDS_REVIEW (nunca ignoradas em silêncio) |
| BILLING_PERIODICITY, PAYMENT_DUE_DAY, ADJUSTMENT_INDEX, ADJUSTMENT_PERIODICITY, OTHER | Informativas | text_value | não afetam cálculo |

Regras de pareamento no motor 1.0.0: um "pool" de franquia por `unit` por versão. Se há
uso acima da franquia e **não** há EXCESS_UNIT_PRICE ativo para a unidade, o run falha
com `NEEDS_REVIEW` (não inventa preço). EXCESS_UNIT_PRICE sem INCLUDED_QUANTITY também é
`NEEDS_REVIEW` (ausência de franquia pode ser falha de extração; franquia zero deve ser
explícita).

---

## 5. ERD conceitual

```
Organization 1─* OrganizationUser *─1 User
Organization 1─1..* MaterialityPolicy (versões)
Organization 1─* Customer 1─* Contract 1─* ContractVersion 1─* ContractRule
                                   │            │                  │ source_document_id
                                   └─* ContractDocument ─1─* ContractDocumentPage
                                                 └─* RuleExtractionRun ─* ContractRule (PROPOSED)
Organization 1─* Import 1─* ImportRow ─0..1→ OperationalEvent | BillingEvent
ImportRow ─* EntityMatch *─0..1 Customer
Customer 1─* OperationalEvent *─0..1 Contract
Customer 1─* Invoice 1─* BillingEvent *─0..1 Contract

EngineRegistry 1─* CalculationRun (engine_name, engine_version)
CalculationRun[EXPECTED_REVENUE] 1─0..1 ExpectedRevenueEvent 1─* ExpectedRevenueComponent
                                                             1─* ComponentSource → ContractRule | OperationalEvent
CalculationRun[RECONCILIATION] (parent_run_id → EXPECTED_REVENUE run)
                         1─0..1 Finding 1─* FindingEvidence → Document/Page/Rule/ImportRow/Event
                                        1─* FindingAction
CalculationRun ─supersedes→ CalculationRun ; Finding ─previous_finding_id→ Finding
ReprocessingJob 1─* CalculationRun
AuditLog (append-only, referencia qualquer entidade por entity_type/entity_id)
```

---

## 6. Schema PostgreSQL inicial

O schema executável está em `supabase/migrations/` (Fase 4). Resumo das decisões
estruturais:

- Schema `app` **não exposto** na Data API do Supabase **[ADR-014]**: o navegador nunca fala
  com tabelas; todo acesso passa pelo servidor Next.js, que abre transação, faz
  `SET LOCAL ROLE authenticated` e `SET LOCAL request.jwt.claims` com as claims do JWT
  verificado. RLS continua ativo como defesa em profundidade e é testado.
- Extensões: `pgcrypto` (uuid/sha), `btree_gist` (exclusão temporal).
- Tipos: dinheiro `numeric(18,2)`, preço unitário e quantidade `numeric(18,6)`, percentual
  `numeric(12,8)` (fração: 0.01 = 1%), fator de índice `numeric(18,10)`, confianças
  `numeric(5,4)` em [0,1], competência `date` com `CHECK (extract(day from c) = 1)`.
- Exclusões temporais: versões ACTIVE de um contrato não se sobrepõem; regras ACTIVE do
  mesmo `(versão, tipo, unidade)` não se sobrepõem.
- Unicidade lógica: `(organization_id, cnpj)` de cliente; `(organization_id, contract_number)`;
  `(contract_id, version_number)`; `(organization_id, type, sha256_hash)` de import não
  duplicado; `(organization_id, dedup_key)` de evento ACTIVE; um único run COMPLETED por
  `(tipo, escopo, competência)`; `calculation_run_id` único em ExpectedRevenueEvent e em
  Finding.
- Invariantes no banco (além do código): `CHECK base+variable+adjustment−discount =
  expected_total`; constraint trigger *deferred* que verifica `SUM(componentes) =
  expected_total` e somas por tipo no commit; `CHECK difference = expected − billed` em
  Finding; trigger que exige `finding.expected_amount = expected_revenue_event.expected_total`.
- Imutabilidade: triggers bloqueiam UPDATE/DELETE em resultados financeiros, evidências,
  ações, audit log, páginas de documento e runs concluídos.

---

## 7. Política monetária **[ADR-002]**

- Moeda: BRL (CHECK `currency = 'BRL'` no MVP).
- Persistência: `numeric`. **Nunca** `float`/`double`/`real`.
- Aplicação: `decimal.js` (precisão 40 dígitos significativos); valores trafegam como
  **string** entre banco ↔ aplicação (driver configurado para não converter `numeric` em
  `number`). Uma regra de lint/teste proíbe `parseFloat`/`Number()` em módulos de domínio.
- XLSX: células numéricas chegam como IEEE-754 do próprio Excel (limite de 15 dígitos
  significativos do Excel); são convertidas com `String(n)` → Decimal sem aritmética em
  float. CSV é lido como texto e convertido diretamente.
- Memória de cálculo: cada componente grava entradas, precisão, modo de arredondamento,
  escala e resultado (`calculation_metadata`) e fórmula legível (`calculation_formula`).

## 8. Política de arredondamento **[ADR-003]**

- Modo: **ROUND_HALF_UP** (meio para longe de zero), escala 2, aplicado **apenas** ao
  valor monetário final de cada componente (`quantidade × preço` → R$). Quantidades e
  excedentes não são arredondados (escala 6). Totais são somas exatas de componentes já
  arredondados; diferenças são subtrações exatas.
- Ponto de atenção (não verificado): não localizei norma oficial que imponha o modo de
  arredondamento para este cálculo gerencial. A ABNT NBR 5891 trata de regras de
  arredondamento, mas não verifiquei seu texto nem sua aplicabilidade aqui. **Confirmar com
  contador**. Trocar o modo exige nova versão do `expected_revenue_engine`.

## 9. Política de competência **[ADR-004]**

- Persistida como `DATE`, sempre dia 1 (CHECK no banco + tipo `Competence` no domínio).
- Parser aceita: `2026-09`, `2026-09-01`, `09/2026`, `9/2026`, `set/26`, `set/2026`,
  `setembro/2026`, `setembro de 2026`, datas `DD/MM/AAAA` (→ mês) e datas nativas do XLSX.
  Datas `MM/DD` **não** são aceitas (padrão brasileiro). Entrada ambígua → linha INVALID.
- Exibição: `09/2026` ou "setembro de 2026". Internamente nunca string.
- Faturamento: ver [ADR-011] (competência explícita, nunca inferida em silêncio).

## 10. Arquitetura de tenancy **[ADR-001]**

- Shared database, shared schema, `organization_id` em toda linha de tenant, RLS em toda
  tabela de tenant, FKs compostas para impedir referências cruzadas.
- Organização ativa da sessão: cookie `ri_org`; **cada requisição revalida** o vínculo ACTIVE
  do usuário com essa organização no banco. Usuário pode ter N organizações.
- Duas vias de acesso ao banco, ambas explícitas no código:
  1. `withUserScope(claims, fn)` — `SET LOCAL ROLE authenticated` + claims; RLS aplicada.
  2. `withSystemScope(orgId, actor, fn)` — `SET LOCAL ROLE service_role`; usado **apenas**
     pelos motores após autorização verificada na via 1; toda query filtra
     `organization_id` e as FKs compostas garantem consistência.
- Storage: buckets privados; caminho `{organization_id}/{uuid}.{ext}` (nome do usuário
  nunca entra no path → sem path traversal). Sem políticas para `anon/authenticated` em
  `storage.objects` (deny-all); download só por signed URL (60 s) emitida pelo servidor
  após checar papel.

## 11. Estratégia RLS **[ADR-010]**

- Funções `app.is_member(org)`, `app.has_role(org, roles[])`, `app.current_user_id()` —
  `SECURITY DEFINER`, `STABLE`, `search_path` fixo, lendo `organization_users` com
  `status = 'ACTIVE'`.
- Políticas por tabela e por operação (SELECT/INSERT/UPDATE), seguindo a matriz 3.2.
  Nenhuma política de DELETE (exclusão física proibida; soft delete via UPDATE).
- Tabelas de saída de motor (`calculation_runs`, `expected_revenue_*`, `findings`,
  `finding_evidence`) **sem** política de escrita para `authenticated`: só o `service_role`
  (motor) grava.
- `finding_actions`: INSERT permitido a ADMIN/FINANCE (AUDITOR só START_REVIEW/NOTE); um
  trigger valida a transição e atualiza o status do finding — **única** via de mudar status.
- `audit_logs`: SELECT para ADMIN/AUDITOR; nenhum INSERT/UPDATE/DELETE para usuários;
  inserção somente por triggers `SECURITY DEFINER`.
- Testes P0: usuário da Org A não lê/escreve nada da Org B (todas as tabelas), papel sem
  permissão recebe negação, e o storage não expõe objetos.

## 12. Contract Versioning **[ADR-005]**

- `ContractVersion(valid_from, valid_until)` com exclusão temporal entre versões ACTIVE.
- Aditivo = nova versão (`source_type = AMENDMENT`) iniciando no dia seguinte ao fim da
  anterior; a anterior só pode ter `valid_until` fechado (nunca reaberto/alterado).
- Correção de versão errada = nova versão (`CORRECTION`) e a errada vira SUPERSEDED
  (preservada; runs antigos continuam apontando para ela).
- Regras pertencem à versão; regra corrigida = nova regra + antiga SUPERSEDED
  (`superseded_by_rule_id`).
- Seleção no motor: versão ACTIVE cuja vigência **cobre o mês inteiro** da competência. Se
  duas versões tocam o mesmo mês (troca no meio do mês) → `NEEDS_REVIEW` (sem pró-rata no
  motor 1.0.0; pró-rata é decisão financeira que exige regra explícita — STOP_CONDITION 7).

## 13. CalculationRun **[ADR-006]**

- Dois tipos encadeados por `parent_run_id`:
  1. `EXPECTED_REVENUE` (`expected_revenue_engine`) → ExpectedRevenueEvent + componentes.
  2. `RECONCILIATION` (`reconciliation_engine`) → Finding (0..1) + evidências.
- `input_snapshot` (JSONB canônico com todas as entradas: versão, regras, eventos,
  parâmetros, política de materialidade) + `input_snapshot_hash` (SHA-256 do JSON canônico)
  + `rules_version_hash`. Permite reproduzir o cálculo mesmo que a origem mude depois.
- Tudo numa transação com `pg_advisory_xact_lock(org, escopo, competência, tipo)`.
- Idempotência: se já existe run COMPLETED com mesmo tipo, escopo, competência, motor,
  versão e hash → retorna o existente (no-op). Se o hash mudou → novo run; o anterior vira
  SUPERSEDED e o novo aponta `supersedes_run_id`. Índice único parcial garante um único run
  COMPLETED por `(tipo, escopo, competência)`.
- Falha (dados incompletos, invariantes, regra não suportada) → run FAILED com
  `error_details {kind: NEEDS_REVIEW|TECHNICAL, code, message}`; nenhum resultado
  financeiro é gravado; o run corrente anterior **não** é substituído.
- "Sem finding" também é resultado auditável: o run de reconciliação grava
  `result_summary` com faturado, diferença e decisão de materialidade.

## 14. Engine Versioning **[ADR-007]**

- `app.engine_registry(engine_name, engine_version)` com `calculation_breaking_change`.
- Constantes no código (`ENGINE_VERSIONS`) e FK de `calculation_runs` para o registro: um
  motor não registrado não consegue gravar run.
- Versões iniciais: `expected_revenue_engine 1.0.0`, `reconciliation_engine 1.0.0`,
  `entity_resolution_engine 1.0.0`, `import_normalization_engine 1.0.0`,
  `contract_rule_extraction_prompt 1.0.0`.
- Mudança de versão → reprocessamento cria novos runs; findings antigos preservam o run (e,
  portanto, a versão) original (TESTE 7).

## 15. Idempotência **[ADR-008]**

| Caso | Mecanismo |
|---|---|
| Upload repetido de arquivo idêntico | SHA-256 + unique `(org, type, sha256)`; novo Import com status DUPLICATE apontando o original |
| Mesmo documento no mesmo contrato | unique `(org, contract, sha256)` ativo |
| Mesma linha em arquivos diferentes | `dedup_key` único por org entre eventos ACTIVE: `ext:<external_id>` quando mapeado; senão `row:<hash do conteúdo normalizado>:<ocorrência>` (a k-ésima linha idêntica no mesmo arquivo recebe k → duplicatas legítimas dentro do arquivo são preservadas, reimportação não duplica) |
| NF repetida | `doc:<número>:<hash da linha>:<ocorrência>`; mesmo número de NF para outro cliente → CONFLICT |
| Retry de job / reload / timeout | tudo transacional; runs e extrações têm chave de idempotência; repetição retorna o resultado existente |
| Cálculo repetido | hash do snapshot (ver §13) |
| Classificação repetida | transição inválida é rejeitada pelo trigger (ex.: CONFIRMED → CONFIRMED) |

## 16. Reprocessamento **[ADR-018]**

1. Mudança identificada (regra substituída, versão, match alterado, evento anulado,
   materialidade, nova versão de motor).
2. Escopo: contratos afetados (por regra/versão/cliente) e intervalo de competências
   (`affected_from..affected_until`), limitado a competências que possuem dados.
3. Cria ReprocessingJob (auditado) → para cada (contrato, competência) executa o pipeline
   com `triggered_by_type = REPROCESSING`.
4. Runs novos só substituem os antigos se COMPLETED. Findings novos nascem OPEN com
   `previous_finding_id`; a classificação anterior é exibida, mas **nunca copiada
   automaticamente** (o motor não classifica). O usuário pode reaplicá-la com uma ação
   explícita.
5. `result_summary` do job: por escopo, expected/billed/diferença antigo × novo e findings
   criados/substituídos.
6. Nada é apagado. Dashboard considera só runs COMPLETED (correntes).

## 17. Fluxo canônico ponta a ponta

| # | Passo | Artefato persistido |
|---|---|---|
| 1 | Admin cria "Acme Serviços Técnicos Ltda." | organizations, organization_users(ADMIN), materiality_policies v1 |
| 2 | Cadastra "Indústria ABC" (CNPJ) | customers |
| 3 | Contrato 00921, versão 1 (01/01/2026–) | contracts, contract_versions |
| 4 | Upload `Contrato.pdf` | contract_documents (sha256, storage privado), contract_document_pages |
| 5 | Extração IA | rule_extraction_runs; 3 contract_rules PROPOSED (18.000; 40 h; 280/h) com página e trecho verificados |
| 6 | Admin confirma e ativa | status CONFIRMED → ACTIVE; audit_logs |
| 7 | Import operacional CSV (Indústria ABC; 09/2026; 57 h) | imports, import_rows, entity_matches (CNPJ exato → MATCHED), operational_events (competence 2026-09-01) |
| 8 | Import de faturamento (NF 1234; 09/2026; R$ 18.000) | imports, import_rows, invoices, billing_events |
| 9 | Cálculo 09/2026 | calculation_runs(EXPECTED_REVENUE, 1.0.0) → expected_revenue_events(base 18.000; variável 4.760; total 22.760) + 2 componentes (BASE; EXCESS 17 × 280) + fontes |
| 10 | Invariantes | código + CHECK + constraint trigger |
| 11 | Reconciliação | calculation_runs(RECONCILIATION, parent) → billed 18.000; diferença 4.760; materialidade (500 AND 1%) atingida |
| 12 | Finding | findings(CONSUMO_EXCEDENTE_NAO_FATURADO, OPEN, 4.760) + finding_evidence (documento, página, cláusula, 3 regras, evento, linha do import, componentes, NF, runs) |
| 13 | Revisão humana | finding_actions(START_REVIEW, CONFIRM…) → status; audit_logs |

Texto do finding: "Possível receita não faturada: R$ 4.760,00".

## 18. Backlog

Ver `BACKLOG.md` (EPIC → STORY → TASK, com prioridade P0–P3, critérios de aceitação,
dependências e riscos).

## 19. Testes obrigatórios (mapa)

| Teste | Nível | Onde |
|---|---|---|
| 1 Excedente 100/117/280 = 4.760 | unidade | `tests/unit/expected-revenue.test.ts` |
| 2 Cobrança abaixo 20.000/18.500 | unidade | `tests/unit/reconciliation.test.ts` |
| 3 Desconto autorizado sem finding | unidade | idem |
| 4 Cliente ativo sem faturamento | unidade | idem |
| 5 Cross-tenant DENIED | integração (Postgres real + RLS) | `tests/integration/rls.test.ts` |
| 6 Reprodutibilidade | unidade + integração | `expected-revenue.test.ts`, `pipeline.test.ts` |
| 7 Versionamento de motor | integração | `pipeline.test.ts` |
| 8 Entity fuzzy → PROPOSED | unidade | `entity-resolution.test.ts` |
| 9 False positive → FindingAction + AuditLog | integração | `findings-workflow.test.ts` |
| 10 Materialidade AND/OR | unidade | `materiality.test.ts` |
| 11 CSV repetido sem duplicar eventos | integração | `imports.test.ts` |
| 12 Retry idêntico | integração | `pipeline.test.ts` |
| 13 Regra 180→280 novo run, histórico preservado | integração | `pipeline.test.ts` |
| 14 Maio v1 / agosto v2 | unidade + integração | `expected-revenue.test.ts` |
| 15 Invariante violada → erro, sem finding | unidade + integração (constraint) | `invariants.test.ts` |
| 16 09/2026 → 2026-09-01 | unidade + integração | `competence.test.ts`, `imports.test.ts` |
| 17 Faturamento duplicado por import | integração | `imports.test.ts` |

## 20. Riscos

| # | Risco | Tipo | Mitigação |
|---|---|---|---|
| R1 | Repositório não corresponde ao produto | organizacional | subdiretório isolado; migrar para repo próprio |
| R2 | Competência de faturamento ≠ competência de execução (NF emitida em M+1) | falso positivo | ADR-011: competência explícita no mapping |
| R3 | Atribuição ambígua (cliente com vários contratos, evento sem contrato) | falso positivo | run NEEDS_REVIEW; nunca rateia |
| R4 | Troca de versão no meio do mês | cálculo | NEEDS_REVIEW, sem pró-rata |
| R5 | Alucinação de cláusula pela IA | integridade | verificação literal do trecho na página + confirmação humana obrigatória |
| R6 | PDF escaneado sem texto | cobertura | status NO_TEXT; OCR fora do MVP; regra manual com trecho transcrito pelo usuário |
| R7 | Envio de contrato a provedor de IA (LGPD / sigilo comercial) | LGPD | provider abstraction; DPA com fornecedor; texto enviado só da organização; sem logs de conteúdo; **decisão do controlador (STOP 11) — ver pendências** |
| R8 | Números em formato BR × US | integridade | formato escolhido no mapping; sem heurística silenciosa |
| R9 | Notas canceladas / notas de crédito | falso negativo/positivo | MVP rejeita valores negativos; linha com status "cancelada" deve ser filtrada pelo usuário; backlog P1 |
| R10 | Tributos retidos / valor líquido × bruto da NF | falso positivo | mapping deve apontar valor **bruto** do serviço; documentado na UI |
| R11 | Conexão direta ao Postgres a partir da Vercel | operação | pooler em modo transação, `prepare: false`; `SET LOCAL` é transacional |
| R12 | Gargalo de aprovação (só ADMIN confirma regras) | produto | leitura literal do spec; revisar após concierge |
| R13 | Cobrança acima do contrato não gera finding | produto | registrado no summary; tipo futuro |
| R14 | XML fiscal sem schema oficial verificado | fiscal | bloqueado (ADR-012) |
| R15 | Arredondamento sem norma verificada | contábil | ADR-003, confirmar com contador |

## 21. Confirmação

**"NÃO ULTRAPASSAREI O HARD MVP SCOPE."**
