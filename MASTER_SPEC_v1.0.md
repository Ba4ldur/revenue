<!--
Arquivo persistido a partir do texto integral do MASTER_SPEC v1.0 fornecido pelo
responsável do produto na sessão de 2026-09-30 (o arquivo não existia no repositório).
Conteúdo transcrito sem alteração semântica; apenas a formatação foi compactada
(linhas em branco entre itens, alguns fluxos verticais escritos em uma linha com "→"). Qualquer mudança relevante exige nova versão
(ver DOCUMENT_IDENTITY). Novas ideias vão para ROADMAP.md / BACKLOG.md.
-->

<MASTER_SPEC version="1.0">

<DOCUMENT_IDENTITY>

Nome do documento:
MASTER_SPEC_v1.0

Produto:
Revenue Intelligence

Nome do produto:
PROVISÓRIO.

Categoria:
Revenue Assurance / Revenue Intelligence.

Mercado inicial:
Brasil.

Modelo:
SaaS B2B.

Objetivo deste documento:

Este documento é a fonte principal de verdade para:

- arquitetura do produto;
- domínio;
- regras financeiras;
- escopo do MVP;
- estratégia de IA;
- segurança;
- multi-tenancy;
- banco de dados;
- auditoria;
- testes;
- UX;
- processamento;
- desenvolvimento;
- roadmap.

Qualquer agente, desenvolvedor, arquiteto ou sistema de IA envolvido na implementação deve considerar este documento como especificação principal.

Novas ideias que não alterem requisitos fundamentais devem ser registradas em:

ROADMAP.md

ou

BACKLOG.md

Não expandir silenciosamente o MASTER_SPEC durante desenvolvimento.

Mudanças relevantes neste documento devem gerar nova versão.

</DOCUMENT_IDENTITY>


<ROLE>

Atue simultaneamente como:

- Principal Product Architect;
- SaaS CTO;
- especialista em Revenue Assurance;
- especialista em Revenue Intelligence;
- especialista em sistemas financeiros B2B;
- arquiteto de software;
- engenheiro full-stack sênior;
- especialista em PostgreSQL;
- especialista em Supabase;
- especialista em arquitetura multi-tenant;
- especialista em segurança de aplicações SaaS;
- especialista em motores determinísticos de cálculo financeiro;
- especialista em reconciliação;
- especialista em processamento de documentos;
- especialista em IA aplicada a documentos empresariais;
- especialista em sistemas auditáveis;
- especialista em integração de dados empresariais.

Sua função não é simplesmente construir telas.

Sua responsabilidade é transformar a tese descrita neste documento em um produto:

- funcional;
- confiável;
- auditável;
- reproduzível;
- seguro;
- multi-tenant;
- financeiramente consistente;
- tecnicamente sustentável;
- preparado para evolução.

Quando possuir ambiente de desenvolvimento:

IMPLEMENTE.

Quando não possuir ambiente de desenvolvimento:

produza especificações suficientemente detalhadas para que outro desenvolvedor consiga implementar sem precisar reinventar decisões essenciais.

Evite respostas vagas como:

"isso poderia ser feito."

Sempre que houver capacidade real para executar:

EXECUTE.

</ROLE>


<INSTRUCTION_PRIORITY>

Em caso de conflito entre instruções deste documento, obedecer à seguinte ordem de prioridade:

1. SECURITY_AND_TENANCY
2. DATA_INTEGRITY
3. HARD_MVP_SCOPE
4. CORE_FINANCIAL_RULES
5. AUDITABILITY_AND_REPRODUCIBILITY
6. DOMAIN_MODEL
7. IMPLEMENTATION_ORDER
8. UX_AND_PRODUCT_DESIGN
9. FUTURE_ROADMAP

Uma instrução de prioridade inferior nunca pode violar uma instrução de prioridade superior.

Exemplos:

- uma funcionalidade do MVP nunca pode reduzir isolamento multi-tenant;
- uma melhoria visual nunca pode comprometer rastreabilidade;
- velocidade de implementação nunca pode justificar cálculo financeiro não reproduzível;
- roadmap futuro nunca pode antecipar funcionalidades que prejudiquem o núcleo do MVP.

</INSTRUCTION_PRIORITY>


<VISION>

O produto será uma plataforma SaaS B2B brasileira de:

REVENUE ASSURANCE / REVENUE INTELLIGENCE.

Nome provisório:

Revenue Intelligence.

O nome NÃO deve ser tratado como definitivo.

A tese central do produto é:

"Conecte ou envie os dados que sua empresa já possui. Nós verificamos se contrato, operação e faturamento estão coerentes e mostramos divergências financeiras sustentadas por evidências."

Outra formulação permitida:

"Não queremos substituir seus sistemas. Queremos verificar se contrato, operação, faturamento e recebimento estão coerentes."

Mensagem comercial possível:

"Você vendeu. Você entregou. Mas será que faturou tudo?"

O produto NÃO será:

- ERP;
- CRM;
- sistema contábil;
- sistema fiscal;
- software de estoque;
- contas a pagar;
- plataforma bancária;
- gateway financeiro;
- sistema completo de billing;
- sistema de cobrança completo;
- sistema de emissão fiscal;
- sistema operacional de serviços;
- sistema de gestão de projetos;
- sistema de tarefas;
- substituto do financeiro existente;
- substituto do ERP existente.

O produto funcionará como uma camada independente de auditoria financeira-operacional.

Ele ficará ACIMA das ferramentas já utilizadas pela empresa.

O cliente poderá continuar usando:

- ERP;
- CRM;
- sistema operacional;
- planilhas;
- Asaas;
- banco;
- sistema fiscal;
- software vertical;
- outros sistemas.

Nosso produto utiliza essas fontes para verificar coerência financeira.

A filosofia estrutural é:

NÃO ADMINISTRAR TODA A EMPRESA.

VERIFICAR SE A RECEITA ESTÁ SENDO CORRETAMENTE FATURADA.

A visão completa do produto é:

CONTRATADO
    ↓
EXECUTADO
    ↓
FATURADO
    ↓
RECEBIDO

Porém o primeiro MVP deve provar apenas:

CONTRATADO
    ↓
EXECUTADO
    ↓
FATURADO

A camada:

FATURADO
    ↓
RECEBIDO

é futura.

</VISION>


<PROBLEM>

Empresas B2B frequentemente operam utilizando várias fontes desconectadas:

- contratos;
- propostas;
- aditivos;
- SLA;
- tabelas de preços;
- planilhas;
- ordens de serviço;
- sistemas operacionais;
- ferramentas de controle de horas;
- ERP;
- notas fiscais;
- contas a receber;
- gateways;
- bancos;
- documentos enviados por e-mail;
- sistemas verticais.

Essas informações frequentemente não são reconciliadas continuamente.

Consequentemente, podem ocorrer situações como:

- mensalidade faturada abaixo do contrato;
- reajuste contratual não aplicado;
- consumo excedente não faturado;
- horas adicionais não faturadas;
- unidades adicionais não faturadas;
- serviço executado sem faturamento;
- preço antigo ainda utilizado;
- aditivo não refletido no ERP;
- contrato ativo sem faturamento;
- faturamento duplicado;
- cobrança acima do contratado;
- descontos sem justificativa documentada;
- diferença entre quantidade executada e quantidade faturada;
- divergências provocadas por erros cadastrais;
- alterações contratuais não refletidas na operação financeira.

A organização pode possuir:

contrato correto;

execução correta;

ERP funcionando;

e ainda assim perder receita porque nenhuma camada verifica continuamente se os três estão coerentes.

O produto existe para executar essa verificação.

REGRA FUNDAMENTAL:

UMA DIVERGÊNCIA NÃO É AUTOMATICAMENTE UMA PERDA FINANCEIRA.

O sistema deve distinguir claramente:

- possível divergência;
- divergência em revisão;
- divergência confirmada;
- divergência justificada;
- falso positivo;
- divergência descartada;
- valor recuperado.

Nunca afirmar automaticamente:

"Você perdeu R$ X."

Antes de confirmação apropriada.

Preferir expressões como:

"Possível receita não faturada."

"Divergência identificada."

"Possível diferença de faturamento."

"Necessita revisão."

"Necessita classificação."

</PROBLEM>


<CORE_CONCEPT>

As quatro camadas conceituais são:

1. CONTRATADO

O que deveria acontecer segundo relações comerciais válidas.

Fontes:

- contrato;
- proposta;
- aditivo;
- SLA;
- tabela de preços;
- política comercial;
- regra de desconto;
- anexos contratuais.

2. EXECUTADO

O que aconteceu operacionalmente.

Fontes:

- horas;
- chamados;
- ordens de serviço;
- unidades;
- usuários;
- consumo;
- entregas;
- quilômetros;
- equipamentos;
- medições;
- atendimentos;
- quantidade utilizada;
- eventos operacionais.

3. FATURADO

O que a empresa efetivamente cobrou.

Fontes:

- NF;
- NFS-e;
- NF-e;
- fatura;
- pedido;
- lançamento;
- recebível;
- ERP;
- billing.

4. RECEBIDO

O que efetivamente entrou financeiramente.

Fontes futuras:

- banco;
- gateway;
- Asaas;
- ERP;
- conciliação financeira.

Perguntas fundamentais:

1. Qual regra contratual estava vigente?
2. O que aconteceu operacionalmente?
3. Quanto deveria ter sido faturado?
4. Quanto foi efetivamente faturado?
5. Existe diferença?
6. Existe justificativa registrada?
7. A diferença ultrapassa a materialidade?
8. Existem evidências suficientes?
9. O cálculo pode ser reproduzido?
10. O finding necessita decisão humana?
11. Qual é o impacto financeiro potencial?
12. Qual é a cadeia de prova?

</CORE_CONCEPT>


<CORE_FINANCIAL_RULE>

PRINCÍPIO CENTRAL:

IA INTERPRETA LINGUAGEM.

CÓDIGO DETERMINÍSTICO CALCULA DINHEIRO.

LLM NÃO pode ser autoridade final sobre:

- multiplicações;
- divisões;
- valores;
- percentuais;
- quantidades;
- datas;
- franquias;
- limites;
- excedentes;
- competência;
- reajustes;
- materialidade;
- diferença financeira;
- expected revenue;
- reconciliação;
- impacto monetário.

Exemplo:

Documento diz:

"Estão incluídas 40 horas mensais. Cada hora adicional será faturada a R$ 280."

IA pode extrair:

included_quantity = 40

unit = HOUR

excess_unit_price = 280

Mas essa extração NÃO vira automaticamente regra ativa.

Fluxo obrigatório:

DOCUMENTO
    ↓
EXTRAÇÃO POR IA
    ↓
REGRA PROPOSTA
    ↓
REVISÃO HUMANA
    ↓
REGRA CONFIRMADA
    ↓
REGRA ATIVA
    ↓
MOTOR FINANCEIRO DETERMINÍSTICO

Nenhuma regra financeira extraída por IA pode ser utilizada automaticamente sem confirmação humana no MVP.

</CORE_FINANCIAL_RULE>


<HARD_MVP_SCOPE>

ESTA SEÇÃO É O LIMITE FORMAL DO MVP 1.

O MVP 1 existe para provar apenas:

"Conseguimos identificar de forma confiável e auditável diferenças reais entre aquilo que deveria ter sido faturado e aquilo que foi faturado."

O MVP obrigatório inclui:

1. autenticação;
2. organizações;
3. usuários;
4. membros das organizações;
5. arquitetura multi-tenant;
6. clientes;
7. contratos;
8. versões de contrato;
9. armazenamento de documentos;
10. upload de contrato PDF;
11. extração de regras por IA;
12. apresentação das regras propostas;
13. confirmação humana;
14. regras ativas;
15. upload de CSV/XLSX operacional;
16. upload de CSV/XLSX/XML de faturamento quando aplicável;
17. preview de importação;
18. mapeamento de colunas;
19. validação;
20. normalização;
21. resolução de entidades;
22. eventos operacionais;
23. eventos de faturamento;
24. Expected Revenue Engine;
25. ExpectedRevenueComponents;
26. CalculationRun;
27. versionamento do motor;
28. reconciliação Expected vs Billed;
29. materialidade;
30. findings;
31. cadeia de evidências;
32. classificação humana de findings;
33. dashboard executivo;
34. trilha de auditoria;
35. tratamento de falso positivo;
36. reprocessamento;
37. idempotência;
38. testes;
39. RLS;
40. proteção de arquivos.

NÃO IMPLEMENTAR NO MVP 1:

- integração Omie;
- integração Conta Azul;
- integração Bling;
- integração Asaas;
- bancos;
- Open Finance;
- contas a receber;
- conciliação bancária;
- emissão de cobrança;
- emissão de boleto;
- emissão fiscal;
- pagamento;
- recebimento;
- chatbot;
- copiloto;
- Margin Assurance;
- ações automáticas no ERP;
- geração automática de cobrança;
- alterações em plataformas externas;
- CRM;
- propostas comerciais;
- estoque;
- contas a pagar;
- gestão operacional;
- workflow genérico.

A arquitetura pode ser preparada para funcionalidades futuras.

Mas elas NÃO devem ser implementadas enquanto o fluxo principal não estiver validado.

</HARD_MVP_SCOPE>


<ICP>

ICP inicial:

Empresas brasileiras B2B com serviços recorrentes ou contratos continuados contendo regras mensuráveis.

Características desejadas:

- múltiplos contratos;
- mensalidade;
- receita recorrente;
- franquia;
- limite incluído;
- horas;
- unidades;
- usuários;
- consumo;
- excedentes;
- serviços adicionais;
- aditivos;
- alterações de preço;
- regras comerciais variáveis.

Segmentos possíveis:

- manutenção;
- facilities;
- terceirização;
- segurança;
- TI B2B;
- MSP;
- suporte;
- outsourcing;
- locação;
- engenharia;
- serviços técnicos;
- BPO;
- software B2B.

O MVP não deve tentar otimizar simultaneamente para todos os setores.

Cenário operacional canônico:

EMPRESA DE SERVIÇOS B2B

com:

- mensalidade fixa;
- franquia;
- quantidade executada;
- preço unitário de excedente.

Evitar inicialmente:

- varejo puro;
- restaurante;
- e-commerce transacional;
- grandes volumes de pequenas vendas sem regra contratual.

</ICP>


<CANONICAL_SCENARIO>

Empresa:

Acme Serviços Técnicos Ltda.

Cliente:

Indústria ABC.

Contrato:

Mensalidade:
R$ 18.000.

Franquia:
40 horas.

Valor da hora excedente:
R$ 280.

Execução da competência:

57 horas.

Cálculo:

57
-
40
=
17 horas excedentes.

17
×
R$ 280
=
R$ 4.760.

Base:

R$ 18.000.

Variável:

R$ 4.760.

Expected Revenue:

R$ 22.760.

Faturamento encontrado:

R$ 18.000.

Difference:

R$ 4.760.

Finding inicial:

"Possível receita não faturada: R$ 4.760."

Cadeia:

Contrato
+
Regra
+
Evento operacional
+
Expected Revenue
+
Faturamento
+
CalculationRun
=
Finding auditável.

Esse fluxo deve funcionar ponta a ponta antes de o MVP ser considerado válido.

</CANONICAL_SCENARIO>


<PRODUCT_PRINCIPLES>

1. Evidência antes de conclusão.
2. Precisão antes de quantidade de alertas.
3. IA interpreta; código calcula.
4. Regra extraída por IA exige confirmação.
5. Divergência não significa automaticamente perda.
6. Todo valor financeiro precisa possuir origem.
7. Todo cálculo deve possuir memória.
8. Todo cálculo deve ser reproduzível.
9. Todo finding deve possuir evidência.
10. Toda regra precisa possuir validade temporal.
11. Histórico nunca deve ser sobrescrito silenciosamente.
12. Sistemas externos não devem ser alterados no MVP.
13. Upload de arquivos deve permanecer disponível mesmo quando integrações futuras existirem.
14. Produto não deve depender de uma única integração.
15. Segurança faz parte da fundação.
16. Auditabilidade faz parte da fundação.
17. RLS faz parte da fundação.
18. Falsos positivos devem ser medidos.
19. Resultado financeiro não pode depender exclusivamente de LLM.
20. Nenhuma funcionalidade visual deve preceder integridade do domínio.

</PRODUCT_PRINCIPLES>


<MONETARY_POLICY>

Moeda inicial do MVP:

BRL.

Internamente:

não utilizar FLOAT.

Valores monetários consolidados:

NUMERIC(18,2)

Exemplo:

amount NUMERIC(18,2)

Valores unitários:

NUMERIC(18,6)

Exemplo:

unit_price NUMERIC(18,6)

Quantidades:

NUMERIC(18,6)

Percentuais:

NUMERIC(12,8)

Fatores de índice:

NUMERIC(18,10)

Regras:

1. Não converter dinheiro para float em JavaScript.
2. Utilizar Decimal library apropriada quando necessário.
3. Não arredondar etapas intermediárias sem necessidade.
4. O arredondamento deve ocorrer somente no ponto previsto pela regra.
5. Política padrão para moeda brasileira deve ser explicitamente registrada.
6. Toda memória de cálculo deve informar:
- valores de entrada;
- precisão;
- arredondamento;
- resultado.
7. Alteração futura da política de arredondamento deve exigir versionamento do motor.

</MONETARY_POLICY>


<COMPETENCE_POLICY>

Competência mensal deve ser persistida como DATE.

Normalização:

primeiro dia do mês.

Exemplo:

setembro de 2026

deve ser armazenado como:

2026-09-01

Interface pode exibir:

09/2026

ou:

Setembro de 2026.

Internamente nunca depender de strings como:

"09/2026"

"set/26"

"setembro/2026".

Competências não mensais futuras devem possuir modelagem explícita.

</COMPETENCE_POLICY>


<DOMAIN_MODEL>

Entidades obrigatórias do MVP:

Organization
User
OrganizationUser
Customer
Contract
ContractVersion
ContractDocument
ContractRule
OperationalEvent
BillingEvent
Invoice
ExpectedRevenueEvent
ExpectedRevenueComponent
CalculationRun
Finding
FindingEvidence
FindingAction
Import
ImportRow
EntityMatch
MaterialityPolicy
AuditLog
EngineRegistry
ReprocessingJob

Entidades futuras:

Receivable
Payment
Connector
SyncRun
BankTransaction
RevenueAdjustment
MarginAnalysis

Para cada entidade documentar:

- responsabilidade;
- campos;
- tipos;
- PK;
- FK;
- constraints;
- índices;
- estados;
- auditoria;
- timestamps;
- soft delete;
- relações.

</DOMAIN_MODEL>


<ORGANIZATION>

Organization representa um tenant.

Campos mínimos:

id UUID
legal_name
trade_name
cnpj nullable inicialmente
timezone
currency
status
created_at
updated_at
deleted_at nullable

Toda entidade pertencente a uma empresa deve conter organization_id quando aplicável.

</ORGANIZATION>


<USER_AND_MEMBERSHIP>

User representa identidade autenticada.

OrganizationUser representa vínculo entre User e Organization.

Campos:

organization_id
user_id
role
status
joined_at
created_at

Papéis iniciais:

ADMIN
FINANCE
COMMERCIAL
AUDITOR
EXECUTIVE

Uma pessoa pode futuramente pertencer a mais de uma Organization.

Permissões devem ser calculadas pelo vínculo.

Nunca assumir que User pertence a apenas uma organização.

</USER_AND_MEMBERSHIP>


<CUSTOMER>

Customer representa o cliente da organização SaaS.

Campos sugeridos:

id
organization_id
legal_name
trade_name
cnpj
external_id nullable
status
metadata limitada
created_at
updated_at
deleted_at

CNPJ quando disponível deve ser normalizado.

Criar índice por:

organization_id + cnpj.

</CUSTOMER>


<CONTRACT>

Contract representa a relação comercial.

Campos:

id
organization_id
customer_id
contract_number
title
status
start_date
end_date nullable
renewal_type nullable
created_at
updated_at
deleted_at

Contract não deve armazenar silenciosamente a versão vigente de todas as regras.

Regras pertencem às versões.

</CONTRACT>


<CONTRACT_VERSIONING>

Toda mudança material precisa ser historicamente rastreável.

ContractVersion:

id
organization_id
contract_id
version_number
valid_from
valid_until nullable
source_type
status
created_by
created_at
superseded_at nullable

Exemplo:

Versão 1:

01/01/2026 até 30/06/2026

Mensalidade:
R$ 18.000.

Versão 2:

a partir de 01/07/2026

Mensalidade:
R$ 20.000.

Competência:

2026-05-01

usa:

versão 1.

Competência:

2026-08-01

usa:

versão 2.

Nunca reescrever regra histórica.

Aditivos devem criar nova versão ou nova regra temporalmente válida.

</CONTRACT_VERSIONING>


<CONTRACT_DOCUMENT>

ContractDocument representa documento relacionado ao contrato.

Campos:

id
organization_id
contract_id
contract_version_id nullable
storage_path
file_name
mime_type
file_size
sha256_hash
document_type
uploaded_by
uploaded_at
deleted_at nullable

Tipos:

CONTRACT
AMENDMENT
PROPOSAL
PRICE_TABLE
SLA
OTHER

Arquivos devem ser privados.

</CONTRACT_DOCUMENT>


<CONTRACT_INTELLIGENCE>

Fluxo obrigatório:

PDF
    ↓
Storage
    ↓
Extração de texto
    ↓
LLM
    ↓
Proposed Rules
    ↓
Human Review
    ↓
Confirmed Rule
    ↓
Active Rule

IA pode identificar:

- mensalidade;
- periodicidade;
- vencimento;
- franquia;
- quantidade incluída;
- unidade;
- preço excedente;
- preço por unidade;
- reajuste;
- periodicidade de reajuste;
- índice;
- desconto;
- tabela de preços;
- deslocamento;
- peças;
- unidade adicional;
- usuário adicional;
- limites;
- serviço adicional.

Toda extração deve preservar provenance:

- documento;
- página;
- trecho;
- posição quando possível.

</CONTRACT_INTELLIGENCE>


<CONTRACT_RULE>

Campos mínimos:

id
organization_id
contract_id
contract_version_id
rule_type
status
currency
numeric_value nullable
text_value nullable
unit nullable
valid_from
valid_until nullable
source_document_id
source_page nullable
source_text
extraction_confidence nullable
confirmed_by nullable
confirmed_at nullable
created_at
updated_at
superseded_at nullable

Estados:

PROPOSED
CONFIRMED
ACTIVE
SUPERSEDED
REJECTED

Regra PROPOSED:

não pode participar do cálculo.

Regra CONFIRMED:

foi aceita por humano.

Regra ACTIVE:

está vigente para cálculo.

SUPERSEDED:

continua histórica.

REJECTED:

extração rejeitada.

</CONTRACT_RULE>


<CONFIDENCE_MODEL>

Nunca utilizar um campo genérico confidence para significar tudo.

Separar:

extraction_confidence

Confiança do modelo na interpretação textual.

entity_match_confidence

Confiança na resolução entre entidades.

evidence_completeness

Qualidade ou completude da cadeia de evidências.

Não utilizar:

financial_confidence.

Cálculo determinístico não deve afirmar:

"87% de confiança no valor."

O cálculo deve ser consequência objetiva das entradas registradas.

</CONFIDENCE_MODEL>


<IMPORT_ENGINE>

Formatos iniciais:

PDF
CSV
XLSX
XML quando necessário.

Fluxo:

UPLOAD
    ↓
VALIDAÇÃO DE ARQUIVO
    ↓
HASH
    ↓
DETECÇÃO
    ↓
PREVIEW
    ↓
TIPO DE IMPORTAÇÃO
    ↓
MAPPING
    ↓
VALIDAÇÃO
    ↓
NORMALIZAÇÃO
    ↓
PERSISTÊNCIA
    ↓
ENTITY RESOLUTION
    ↓
PROCESSAMENTO

Tipos:

OPERATIONAL
BILLING
CONTRACT_SUPPORT

Campos que o usuário pode mapear:

cliente
CNPJ
external_customer_id
data
competência
descrição
quantidade
horas
unidades
valor
número da NF
document_number
contract_number
external_event_id

</IMPORT_ENGINE>


<IMPORT>

Import deve registrar:

id
organization_id
type
file_name
storage_path
sha256_hash
source_system nullable
mapping_version
status
row_count
valid_rows
invalid_rows
duplicate_rows
uploaded_by
created_at
started_at
completed_at
error_summary nullable

Estados:

UPLOADED
MAPPING_REQUIRED
VALIDATING
PROCESSING
COMPLETED
COMPLETED_WITH_ERRORS
FAILED
DUPLICATE

</IMPORT>


<IMPORT_ROW>

ImportRow deve armazenar:

id
organization_id
import_id
row_number
raw_data
normalized_data
row_hash
status
error_message nullable
target_entity_type nullable
target_entity_id nullable
created_at

Raw/normalized podem utilizar JSONB porque representam payload de importação.

Dados financeiros finais devem ser estruturados.

</IMPORT_ROW>


<IDEMPOTENCY>

Idempotência é requisito obrigatório.

O mesmo input não pode criar resultado financeiro duplicado por simples reexecução.

Casos:

- upload repetido;
- retry de job;
- reload;
- timeout;
- execução manual repetida;
- reprocessamento.

Utilizar quando apropriado:

sha256_hash
organization_id
source_type
external_id
competence
customer_id
contract_id
row_hash
idempotency_key

Regras:

1. Mesmo arquivo idêntico deve ser detectável.
2. Mesmo evento externo não deve ser persistido duas vezes.
3. Mesmo CalculationRun não deve duplicar findings silenciosamente.
4. Retry de job deve ser seguro.
5. Reprocessamento intencional deve gerar nova execução versionada, não duplicidade acidental.

</IDEMPOTENCY>


<ENTITY_RESOLUTION>

Objetivo:

identificar quando registros de diferentes fontes representam a mesma entidade.

Prioridade:

1. CNPJ exato;
2. external_id confirmado;
3. vínculo anteriormente confirmado;
4. razão social normalizada;
5. nome fantasia;
6. fuzzy matching.

Estados:

MATCHED
PROPOSED
UNMATCHED
REJECTED

Regras:

- CNPJ exato pode permitir matching automático;
- fuzzy matching não pode ser confirmado silenciosamente;
- matching de baixa confiança deve exigir usuário;
- confirmação deve gerar EntityMatch;
- rejeição deve ser registrada;
- vínculo confirmado pode ser reutilizado em imports futuros.

</ENTITY_RESOLUTION>


<OPERATIONAL_EVENT>

Representa fato operacional.

Exemplos:

- horas;
- unidades;
- usuários;
- chamados;
- consumo;
- entregas.

Campos:

id
organization_id
customer_id
contract_id nullable
competence
event_date nullable
event_type
quantity
unit
external_id nullable
source_import_id
source_import_row_id
description
created_at

OperationalEvent representa FATO.

Não deve conter interpretação financeira do contrato.

</OPERATIONAL_EVENT>


<BILLING_EVENT>

Representa faturamento identificado.

Campos:

id
organization_id
customer_id
contract_id nullable
competence
billing_date
document_number
invoice_id nullable
description
amount
currency
external_id nullable
source_import_id
source_import_row_id
created_at

BillingEvent representa FATO FATURADO.

Não representa necessariamente pagamento.

</BILLING_EVENT>


<EXPECTED_REVENUE_ENGINE>

Este é o núcleo de propriedade intelectual do produto.

Pergunta:

"Quanto deveria ter sido faturado?"

Motor:

100% determinístico.

Entradas:

- organização;
- cliente;
- contrato;
- versão contratual;
- competência;
- regras ativas;
- eventos operacionais;
- parâmetros;
- descontos confirmados;
- exceções válidas.

Saída:

ExpectedRevenueEvent.

Exemplo:

Base:
R$ 20.000.

Franquia:
100 horas.

Uso:
117 horas.

Excedente:
17.

Unit price:
R$ 280.

Variável:
R$ 4.760.

Expected:
R$ 24.760.

</EXPECTED_REVENUE_ENGINE>


<EXPECTED_REVENUE_EVENT>

Campos:

id
organization_id
customer_id
contract_id
contract_version_id
competence
base_amount
variable_amount
adjustment_amount
discount_amount
expected_total
currency
calculation_run_id
created_at

Unique lógico deve impedir duplicidade acidental para mesma execução.

</EXPECTED_REVENUE_EVENT>


<EXPECTED_REVENUE_COMPONENT>

Cada parte do Expected Revenue deve possuir componente.

Campos:

id
organization_id
expected_revenue_event_id
component_type
description
quantity nullable
unit nullable
unit_price nullable
amount
source_rule_id nullable
source_operational_event_id nullable
calculation_formula
calculation_metadata
created_at

Tipos possíveis:

BASE
EXCESS
ADDITIONAL_SERVICE
ADJUSTMENT
DISCOUNT
OTHER

</EXPECTED_REVENUE_COMPONENT>


<FINANCIAL_INVARIANTS>

Invariantes obrigatórios:

expected_total
=
SUM(ExpectedRevenueComponent.amount)

ou, quando componentes forem classificados:

base_amount
+
variable_amount
+
adjustment_amount
-
discount_amount
=
expected_total

Para findings de cobrança abaixo:

difference_amount
=
expected_amount
-
billed_amount

Não permitir:

Finding.amount diferente da memória de cálculo.

Não permitir:

ExpectedRevenueEvent incompatível com seus componentes.

Não publicar finding quando:

- invariantes falharem;
- CalculationRun falhar;
- dados essenciais estiverem incompletos;
- regra estiver inconsistente.

Nesses casos:

registrar erro técnico;

não criar resultado financeiro como válido.

</FINANCIAL_INVARIANTS>


<CALCULATION_RUN>

Toda execução financeira importante deve possuir CalculationRun.

Finalidade:

reprodução.

Campos:

id
organization_id
engine_name
engine_version
calculation_type
scope_type
scope_id
competence nullable
status
input_snapshot_hash
rules_version_hash
parameters
started_at
completed_at nullable
triggered_by_type
triggered_by_user_id nullable
parent_run_id nullable
supersedes_run_id nullable
result_summary
error_details nullable
created_at

Estados:

PENDING
RUNNING
COMPLETED
FAILED
SUPERSEDED

Cada Finding deve saber qual CalculationRun o gerou.

</CALCULATION_RUN>


<ENGINE_VERSIONING>

Registrar versão explícita de motores.

Exemplo:

expected_revenue_engine = 1.0.0
reconciliation_engine = 1.0.0
entity_resolution_engine = 1.0.0

Mudança que altera resultado financeiro deve gerar nova versão.

Finding histórico deve preservar versão original.

Nunca reprocessar dados históricos e apagar silenciosamente o resultado produzido anteriormente.

</ENGINE_VERSIONING>


<ENGINE_REGISTRY>

Criar estrutura que permita registrar:

engine_name
engine_version
deployed_at
description
change_summary
calculation_breaking_change boolean
created_at

Isso permite saber exatamente quais versões existiram.

</ENGINE_REGISTRY>


<RECONCILIATION_ENGINE>

MVP:

EXPECTED
    VS
BILLED.

Não incluir RECEIVED ainda.

Fluxo:

ExpectedRevenueEvent
    ↓
BillingEvent(s)
    ↓
matching
    ↓
total billed
    ↓
difference
    ↓
known explanations
    ↓
materiality
    ↓
finding candidate

Antes de abrir finding, avaliar:

- desconto confirmado;
- crédito comercial;
- cancelamento;
- aditivo;
- alteração de escopo;
- exceção registrada;
- regra comercial confirmada.

Priorizar precisão.

Evitar findings de baixa utilidade.

</RECONCILIATION_ENGINE>


<DETECTION_VS_CLASSIFICATION>

REGRA DE DOMÍNIO:

Finding Engine DETECTA.

Human Workflow CLASSIFICA.

Um finding gerado automaticamente deve nascer:

OPEN.

Motor nunca pode gerar automaticamente:

CONFIRMED
JUSTIFIED
FALSE_POSITIVE
DISCARDED
RECOVERED

Esses estados exigem ação humana.

UNDER_REVIEW pode ser atribuído quando usuário iniciar investigação.

</DETECTION_VS_CLASSIFICATION>


<FINDING_TYPES_MVP>

Implementar somente inicialmente:

CONSUMO_EXCEDENTE_NAO_FATURADO
COBRANCA_ABAIXO_DO_CONTRATO
CLIENTE_ATIVO_SEM_FATURAMENTO

Opcional depois do núcleo estabilizado:

REAJUSTE_NAO_APLICADO.

Não implementar antecipadamente:

SERVICO_NAO_FATURADO
DESCONTO_NAO_PREVISTO
PRECO_ANTIGO
ADITIVO_NAO_REFLETIDO
FATURAMENTO_DUPLICADO
COBRANCA_ACIMA_DO_CONTRATADO
PAGAMENTO_PARCIAL
RECEBIMENTO_NAO_CONCILIADO

</FINDING_TYPES_MVP>


<FINDING>

Campos:

id
organization_id
customer_id
contract_id
contract_version_id nullable
competence
finding_type
expected_amount
billed_amount
difference_amount
currency
severity
status
extraction_confidence nullable
entity_match_confidence nullable
evidence_completeness nullable
explanation
calculation_run_id
expected_revenue_event_id
detected_at
created_at
updated_at
resolved_at nullable

Estados:

OPEN
UNDER_REVIEW
CONFIRMED
JUSTIFIED
FALSE_POSITIVE
DISCARDED
RECOVERED

</FINDING>


<FINDING_STATE_MEANING>

OPEN

Divergência detectada automaticamente.

UNDER_REVIEW

Humano iniciou investigação.

CONFIRMED

Humano confirmou que a divergência é real e requer ação.

JUSTIFIED

Existe divergência matemática, mas ela possui justificativa comercial ou contratual válida.

FALSE_POSITIVE

O mecanismo detectou incorretamente uma divergência.

DISCARDED

Finding foi descartado por decisão operacional documentada.

RECOVERED

O valor relacionado foi recuperado posteriormente.

Nunca misturar:

JUSTIFIED

com

FALSE_POSITIVE.

</FINDING_STATE_MEANING>


<FINDING_ACTION>

Toda ação humana deve criar FindingAction.

Campos:

id
organization_id
finding_id
action_type
previous_status
new_status
reason nullable
notes nullable
performed_by
performed_at
attachment_id nullable

</FINDING_ACTION>


<EVIDENCE_CHAIN>

Cada Finding precisa possuir cadeia de prova.

Exemplo:

Finding #1182

Cliente:
Indústria ABC.

Contrato:
00921.

Competência:
09/2026.

Documento:
Contrato.pdf.

Página:
7.

Cláusula:
"40 horas mensais incluídas..."

Regra:
40 horas incluídas.

Preço excedente:
R$ 280/h.

Evento operacional:
57 horas.

Excedente:
17 horas.

Cálculo:
17 × 280.

Resultado variável:
R$ 4.760.

Base:
R$ 18.000.

Expected:
R$ 22.760.

NF:
R$ 18.000.

Diferença:
R$ 4.760.

Conclusão:

Possível receita não faturada de R$ 4.760.

Usuário precisa conseguir abrir:

- PDF;
- página;
- trecho;
- regra;
- import;
- linha;
- evento;
- cálculo;
- billing;
- histórico.

</EVIDENCE_CHAIN>


<FINDING_EVIDENCE>

Campos:

id
organization_id
finding_id
evidence_type
entity_type
entity_id
description
source_document_id nullable
source_import_id nullable
source_import_row_id nullable
source_rule_id nullable
source_event_id nullable
page_number nullable
text_excerpt nullable
created_at

Evidência utilizada por finding não pode ser silenciosamente destruída.

</FINDING_EVIDENCE>


<MATERIALITY>

Cada Organization deve possuir MaterialityPolicy.

Modos:

ABSOLUTE
PERCENTAGE
COMBINED

Campos:

absolute_threshold
percentage_threshold
combination_operator

combination_operator:

AND
OR

Exemplo:

absolute_threshold:

R$ 500.

percentage_threshold:

1%.

AND:

finding apenas quando ambas condições forem atingidas.

OR:

finding quando qualquer uma for atingida.

A interface deve explicar a diferença.

Mudança de materialidade não deve apagar finding histórico.

Pode gerar reavaliação.

</MATERIALITY>


<REPROCESSING>

Reprocessamento é funcionalidade fundamental.

Eventos que podem exigir reprocessamento:

- ContractRule corrigida;
- nova ContractVersion;
- regra rejeitada;
- alteração de EntityMatch;
- Import substituído;
- ImportRow corrigido;
- OperationalEvent corrigido;
- BillingEvent corrigido;
- mudança de materialidade;
- nova versão do motor;
- bug financeiro corrigido.

Fluxo:

MUDANÇA
    ↓
identificar escopo afetado
    ↓
identificar competências afetadas
    ↓
criar novo ReprocessingJob
    ↓
criar novo CalculationRun
    ↓
gerar novos Expected Revenue
    ↓
reconciliar
    ↓
comparar resultado antigo e novo
    ↓
preservar histórico

Nunca apagar silenciosamente CalculationRun anterior.

Nunca fingir que resultado antigo nunca existiu.

</REPROCESSING>


<REPROCESSING_JOB>

Campos:

id
organization_id
reason
trigger_entity_type
trigger_entity_id
affected_from
affected_until
status
created_by
created_at
started_at
completed_at
result_summary
parent_job_id nullable

</REPROCESSING_JOB>


<DATA_PROVENANCE>

Todo dado financeiro importante deve permitir responder:

De onde veio?

Possíveis origens:

CONTRACT_DOCUMENT
CONTRACT_RULE
OPERATIONAL_IMPORT
BILLING_IMPORT
MANUAL_ENTRY
CALCULATION
FUTURE_CONNECTOR

Manter referências de origem em todas as etapas relevantes.

Objetivo:

nenhum número importante deve aparecer no dashboard sem possibilidade de rastreamento.

</DATA_PROVENANCE>


<AUDIT_LOG>

Registrar ações sensíveis.

Exemplos:

- criação;
- alteração;
- exclusão lógica;
- upload;
- confirmação de regra;
- rejeição;
- alteração de regra;
- criação de nova versão;
- importação;
- matching;
- override;
- finding;
- classificação;
- justificativa;
- false positive;
- recovery;
- alteração de usuário;
- alteração de permissão;
- alteração de materialidade;
- reprocessamento.

Campos:

id
organization_id
actor_user_id nullable
actor_type
action
entity_type
entity_id
before_data nullable
after_data nullable
metadata nullable
created_at

AuditLog:

- append-only;
- não editável pelo usuário comum;
- protegido por RLS;
- consultável por perfis autorizados.

</AUDIT_LOG>


<MULTITENANCY>

Estratégia:

shared database
shared schema
organization_id
RLS.

Todo registro pertencente a tenant precisa ser isolado.

Nenhum usuário da Organization A pode consultar:

- clientes;
- contratos;
- documentos;
- regras;
- imports;
- eventos;
- findings;
- audit logs;
- configurações

da Organization B.

Testes cross-tenant são P0.

</MULTITENANCY>


<PERMISSIONS>

ADMIN:

- tudo na organização;
- usuários;
- configurações;
- contratos;
- regras;
- findings;
- imports;
- auditoria.

FINANCE:

- dashboard;
- imports financeiros;
- faturamento;
- findings;
- classificação.

COMMERCIAL:

- clientes;
- contratos;
- documentos;
- consulta de regras.

AUDITOR:

- leitura ampla;
- investigação;
- findings;
- evidências;
- auditoria.

EXECUTIVE:

- dashboard;
- indicadores;
- leitura de findings relevantes.

Implementar princípio de menor privilégio.

</PERMISSIONS>


<SECURITY_AND_TENANCY>

Obrigatório desde o início:

- HTTPS;
- Supabase Auth;
- RLS;
- Storage privado;
- signed URLs;
- validação de autorização server-side;
- validação de extensão;
- validação de MIME;
- limite de tamanho;
- geração de hash;
- proteção contra path traversal;
- proteção horizontal;
- proteção vertical;
- secrets no ambiente;
- nenhuma credencial em código;
- logs;
- backups;
- LGPD;
- isolamento multi-tenant.

Não armazenar senha de ERP.

Futuras integrações devem preferir:

- OAuth;
- API keys;
- tokens revogáveis.

</SECURITY_AND_TENANCY>


<DATA_INTEGRITY>

Prioridade máxima depois de segurança.

Regras:

1. Não utilizar float para dinheiro.
2. FK sempre que aplicável.
3. Unique constraints sempre que houver identidade lógica.
4. Imports precisam ser idempotentes.
5. CalculationRun deve ser imutável depois de concluído, salvo metadata operacional não financeira.
6. ExpectedRevenueEvent gerado deve ser associado ao CalculationRun.
7. Finding deve referenciar origem.
8. Histórico contratual não pode ser apagado.
9. Reprocessamentos criam nova execução.
10. Alterações manuais precisam de AuditLog.

</DATA_INTEGRITY>


<DATABASE>

Banco:

PostgreSQL.

Plataforma:

Supabase.

Preferências:

UUID
timestamptz
numeric
FK
unique constraints
indexes
check constraints
RLS.

JSONB somente quando justificável.

JSONB permitido para:

- raw imports;
- snapshots;
- metadata;
- payloads;
- contexto auxiliar.

Não armazenar informações financeiras essenciais exclusivamente em JSON.

</DATABASE>


<SOFT_DELETE>

Aplicar quando necessário em:

Organization
Customer
Contract
ContractDocument.

Não usar soft delete para esconder histórico financeiro.

CalculationRun:
preservar.

Finding:
preservar.

AuditLog:
preservar.

ContractRule histórica:
preservar.

</SOFT_DELETE>


<ASYNC_JOBS>

Processos potencialmente assíncronos:

- extração PDF;
- análise de contrato;
- imports;
- normalization;
- entity resolution;
- Expected Revenue;
- reconciliação;
- reprocessamento;
- integrações futuras.

Jobs precisam ser:

- idempotentes;
- retry-safe;
- observáveis;
- rastreáveis;
- associados à organização.

Estados:

PENDING
RUNNING
COMPLETED
FAILED
CANCELLED

</ASYNC_JOBS>


<OBSERVABILITY>

Implementar logs técnicos adequados.

Registrar:

- job id;
- organization;
- engine version;
- duration;
- erro;
- quantidade processada.

Não registrar conteúdo sensível desnecessariamente.

Métricas técnicas futuras:

processing time
failure rate
import error rate
finding generation rate
false positive rate.

</OBSERVABILITY>


<TECH_STACK>

Frontend:
Next.js.
App Router.
React.
TypeScript.

Backend:
Next.js server-side quando apropriado.
Serviços TypeScript.

Database:
PostgreSQL.

Platform:
Supabase.

Auth:
Supabase Auth.

Storage:
Supabase Storage.

Hosting:
Vercel.

Validação:
biblioteca consistente de schema validation.

Dinheiro:
biblioteca Decimal quando necessário.

IA:
provider abstraction.

Jobs:
solução apropriada e idempotente.

Não acoplar domínio financeiro a um fornecedor único.

</TECH_STACK>


<CODE_ARCHITECTURE>

Separar:

Presentation
Application
Domain
Persistence
Infrastructure
AI
Jobs.

Estrutura conceitual:

src/
    app/
    components/

    features/
        organizations/
        members/
        customers/
        contracts/
        contract-rules/
        imports/
        entity-resolution/
        operations/
        billing/
        expected-revenue/
        reconciliation/
        findings/
        dashboard/
        audit/
        settings/

    domain/
        money/
        contracts/
        revenue/
        reconciliation/
        findings/

    application/

    repositories/

    integrations/

    ai/

    jobs/

    lib/

Não colocar cálculo financeiro crítico em:

- React components;
- route handlers;
- prompts;
- SQL ad-hoc espalhado.

Centralizar domínio financeiro.

</CODE_ARCHITECTURE>


<MVP_ROUTES>

Construir inicialmente:

/login
/dashboard
/customers
/customers/[id]
/contracts
/contracts/[id]
/contracts/[id]/rules
/imports
/imports/[id]
/findings
/findings/[id]
/settings
/settings/members
/settings/materiality
/settings/audit

Não construir chat no MVP.

</MVP_ROUTES>


<UX_PRINCIPLES>

A aplicação deve transmitir:

- confiança;
- precisão;
- seriedade;
- clareza;
- auditabilidade.

Evitar:

- visual de chatbot;
- aparência de template de IA;
- gráficos decorativos;
- cards vazios;
- textos genéricos;
- animações sem função;
- excesso de informação.

O usuário deve conseguir responder rapidamente:

Quanto?
Onde?
Por quê?
Qual contrato?
Qual regra?
Qual competência?
Qual cálculo?
Qual evidência?
Qual status?
Quem confirmou?
Foi justificado?
Era falso positivo?
Foi recuperado?

</UX_PRINCIPLES>


<DASHBOARD>

Cards principais:

RECEITA MONITORADA
DIVERGÊNCIAS ABERTAS
DIVERGÊNCIAS CONFIRMADAS
RECEITA RECUPERADA

Enquanto recuperação ainda não estiver plenamente implementada, pode exibir zero ou estado informativo.

Seções:

Maiores divergências.
Findings recentes.
Contratos com maior impacto.
Distribuição por tipo.
Distribuição por status.

Nunca criar gráfico sem utilidade decisória.

</DASHBOARD>


<CONTRACT_SCREEN>

Mostrar:

- cliente;
- número;
- status;
- vigência;
- versões;
- documentos;
- regras;
- receita esperada;
- faturamento;
- findings;
- histórico;
- auditoria.

Permitir navegar entre versões.

Mostrar claramente qual versão estava vigente em cada competência.

</CONTRACT_SCREEN>


<FINDING_SCREEN>

Seções:

Resumo
Impacto
Status
Regra
Contrato
Execução
Expected Revenue
Faturamento
Cálculo
Evidências
Histórico
Ações

Usuário precisa compreender o finding sem abrir planilha externa.

</FINDING_SCREEN>


<AI_STRATEGY>

LLM permitido para:

- extração;
- classificação textual;
- normalização;
- explicação;
- auxílio ao usuário.

LLM proibido como autoridade de:

- dinheiro;
- resultado;
- materialidade;
- regra ativa;
- confirmação;
- recuperação.

Nunca inventar:

- cláusula;
- índice;
- valor;
- evidência;
- documento;
- faturamento;
- evento.

Prompts de extração devem possuir versionamento quando mudanças puderem afetar resultados.

</AI_STRATEGY>


<AI_EXTRACTION_OUTPUT>

Quando extrair regra de contrato, retornar estrutura validável.

Exemplo conceitual:

{
  rule_type,
  proposed_value,
  unit,
  currency,
  valid_from,
  valid_until,
  source_page,
  source_text,
  extraction_confidence
}

Se não encontrar informação:

retornar null explícito.

Nunca inventar.

</AI_EXTRACTION_OUTPUT>


<ERROR_HANDLING>

Erros financeiros devem ser tratados conservadoramente.

Se faltar:

- regra;
- cliente;
- competência;
- quantidade;
- preço;
- documento;

não inventar.

Estado apropriado:

NEEDS_REVIEW

ou erro técnico.

Falha em cálculo:

não gerar finding financeiro válido.

Falha em import:

mostrar linhas rejeitadas.

Falha parcial:

preservar dados válidos quando estratégia permitir.

</ERROR_HANDLING>


<TESTING>

Testes obrigatórios.

TESTE 1 — Excedente.
Incluído: 100 horas. Utilizado: 117. Adicional: R$ 280.
Resultado: R$ 4.760.

TESTE 2 — Cobrança abaixo.
Expected: R$ 20.000. Billed: R$ 18.500.
Difference: R$ 1.500.

TESTE 3 — Desconto autorizado.
Expected bruto: R$ 20.000. Discount: R$ 1.500. Expected líquido: R$ 18.500.
Billed: R$ 18.500.
Resultado: sem finding.

TESTE 4 — Contrato sem faturamento.
Contrato ativo. Expected: R$ 18.000. Billed: R$ 0.
Resultado: CLIENTE_ATIVO_SEM_FATURAMENTO.

TESTE 5 — Cross tenant.
User A tenta acessar Contract B.
Resultado: DENIED.

TESTE 6 — Reprodutibilidade.
Mesmos inputs. Mesma engine_version.
Resultado idêntico.

TESTE 7 — Versionamento.
Finding criado com engine 1.0.0. Engine atualizada para 1.1.0.
Finding anterior mantém: 1.0.0.

TESTE 8 — Entity fuzzy.
Match baixa confiança.
Resultado: PROPOSED. Não MATCHED.

TESTE 9 — False Positive.
Usuário classifica.
Resultado: FindingAction, AuditLog.

TESTE 10 — Materiality AND.
Testar resultado.
Materiality OR.
Testar diferença.

TESTE 11 — Idempotência.
Importar mesmo CSV duas vezes.
Resultado: nenhum OperationalEvent duplicado.

TESTE 12 — Retry.
Executar job duas vezes.
Resultado final idêntico.

TESTE 13 — Regra corrigida.
R$ 180/h corrigido para R$ 280/h.
Resultado: novo CalculationRun. Histórico preservado.

TESTE 14 — Contract version.
Maio usa versão 1. Agosto usa versão 2.

TESTE 15 — Invariante.
Soma de componentes diferente do expected_total.
Resultado: erro. Não publicar finding.

TESTE 16 — Competência.
09/2026 importado.
Persistir: 2026-09-01.

TESTE 17 — Faturamento duplicado acidental por import.
Não duplicar.

</TESTING>


<SEED_DATA>

Organization:
Acme Serviços Técnicos Ltda.

Customer:
Indústria ABC.

Contract:
mensalidade: R$ 18.000.
franquia: 40h.
extra: R$ 280/h.

OperationalEvent:
57h.

Billing:
R$ 18.000.

Expected:
R$ 22.760.

Finding:
R$ 4.760.

Adicionar cenários:

- cobrança abaixo;
- cliente sem faturamento;
- desconto autorizado;
- falso positivo;
- segunda versão contratual;
- match proposto.

</SEED_DATA>


<PRODUCT_METRICS>

Métricas iniciais:

valor monitorado
findings detectados
findings confirmados
findings justificados
false positive rate
tempo até primeiro finding
valor potencial identificado
percentual de findings com evidência completa
tempo médio de classificação
taxa de importação com erro

</PRODUCT_METRICS>


<BUSINESS_METRICS>

Futuras:

MRR
ARR
clientes ativos
churn
ARPA
CAC
LTV
conversão diagnóstico → assinatura
tempo para ativação
valor identificado por cliente

</BUSINESS_METRICS>


<MVP_SUCCESS_CRITERIA>

Critério técnico:
o cenário canônico funciona ponta a ponta.

Critério de qualidade:
finding possui evidência e cálculo reproduzível.

Critério de segurança:
isolamento multi-tenant validado.

Critério comercial:
validar com operações reais.

Idealmente:
5 empresas.

Sinal positivo:
divergências relevantes encontradas em pelo menos parte significativa da amostra.

Mais importante:
empresário considera o resultado confiável e demonstra disposição real de pagar.

</MVP_SUCCESS_CRITERIA>


<MVP0_CONCIERGE>

Antes ou durante desenvolvimento:
executar auditoria manual/semiassistida.

Entrada:
contratos, dados operacionais, faturamento.

Processo:
interpretar regras; calcular esperado; comparar faturado; identificar divergências; validar com empresa.

Objetivo:
descobrir padrões reais que devem orientar o produto.

Não inventar tipos de findings apenas teoricamente.

</MVP0_CONCIERGE>


<FUTURE_INTEGRATIONS>

Somente depois de validar MVP 1.

Categorias:
ERP, Payments, Documents, Operational, Fiscal.

Possíveis:
Omie, Conta Azul, Bling, Asaas, Google Drive, OneDrive.

Criar interface comum:

Connector
authenticate()
testConnection()
syncCustomers()
syncBillingEvents()
syncOperationalEvents()
syncReceivables()
syncPayments()
getSyncStatus()

Padrão:
READ ONLY.

Consultar sempre documentação oficial atual antes de implementar.

Nunca inventar: endpoint, scope, OAuth, webhook, rate limit, payload.

</FUTURE_INTEGRATIONS>


<FUTURE_RECEIVABLES>

Após Expected vs Billed estar validado:

BILLED
    ↓
RECEIVED.

Possíveis divergências:
PAGAMENTO_PARCIAL, RECEBIMENTO_NAO_CONCILIADO, PAGAMENTO_A_MENOR, PAGAMENTO_DUPLICADO, RETENCAO_NAO_CLASSIFICADA.

Diferença entre faturado e recebido não significa automaticamente perda.

Pode existir: retenção, glosa, desconto, abatimento, compensação, tributação, pagamento parcial.

</FUTURE_RECEIVABLES>


<FUTURE_AI_ASSISTANT>

Não implementar no MVP.

Futuro:
"Quanto deixamos de faturar nos últimos seis meses?"
"Quais contratos possuem findings?"
"Quais clientes ficaram sem faturamento?"
"Explique o finding 1182."
"Quais findings foram falsos positivos?"

Respostas precisam utilizar dados estruturados.

Nunca inventar número.

</FUTURE_AI_ASSISTANT>


<FUTURE_MARGIN_ASSURANCE>

Geração 1: Revenue Assurance. "Estou faturando tudo que deveria?"

Geração 2: Revenue & Margin Assurance. "Estou ganhando o que deveria?"

Possíveis fontes futuras: mão de obra; horas; impostos; terceiros; custos; deslocamento; margem prevista; margem real.

Não desenvolver no MVP atual.

</FUTURE_MARGIN_ASSURANCE>


<FUTURE_AUTOMATION>

MVP não modifica sistemas externos.

Futuro possível:

Finding confirmado
    ↓
Prepare Correction
    ↓
humano revisa
    ↓
criar cobrança
    ↓
ERP ou gateway.

Nunca permitir ações financeiras externas sem aprovação apropriada.

</FUTURE_AUTOMATION>


<COMMERCIAL_POSITIONING>

Não vender como: "ERP novo."
Não vender como: "Gestão de contratos."
Não vender como: "Mais um sistema financeiro."

Posicionamento:
"Uma camada independente que verifica se sua empresa está faturando aquilo que seus contratos e sua operação indicam que deveria faturar."

Mensagem:
"Sua empresa tem certeza de que está faturando tudo aquilo que seus contratos permitem?"

Possível estratégia de entrada: auditoria retroativa. Analisar: 3 meses, 6 meses, 12 meses.

Momento de valor: "Encontramos R$ X em divergências potenciais."

Depois: converter para monitoramento contínuo.

</COMMERCIAL_POSITIONING>


<PRICING_FUTURE>

Pricing NÃO é definitivo.

Pode futuramente considerar: quantidade de contratos; receita monitorada; volume de eventos; número de CNPJs; integrações; usuários.

Hipóteses podem ser testadas.

Não codificar pricing rígido prematuramente.

</PRICING_FUTURE>


<ROADMAP>

MVP 0 — Auditoria concierge.
MVP 1 — Contracts + Rules + Operations + Billing + Expected Revenue + Reconciliation + Findings + Evidence.
MVP 2 — Conectores read-only.
MVP 3 — Monitoramento contínuo.
MVP 4 — Recebimentos.
MVP 5 — Preparação de correção.
MVP 6 — Ações externas aprovadas.
MVP 7 — Revenue & Margin Assurance.

Nunca antecipar roadmap se isso reduzir qualidade do núcleo.

</ROADMAP>


<BACKLOG_POLICY>

Organizar trabalho em: EPIC, STORY, TASK.

Story deve conter: Título, Problema, Descrição, Critérios de aceitação, Dependências, Riscos, Prioridade.

Prioridades: P0, P1, P2, P3.

P0: segurança; tenancy; RLS; contratos; regras; imports; Expected Revenue; CalculationRun; reconciliation; findings; evidence; audit.

</BACKLOG_POLICY>


<DECISION_LOG>

Manter ADR / Decision Log.

Para cada decisão: ID, Título, Problema, Decisão, Justificativa, Alternativas, Consequências, Data, Status.

Decisões mínimas: multi-tenancy; money precision; rounding; competence; contract versioning; engine versioning; materiality; import strategy; AI provider abstraction; RLS; storage; false positive; reprocessing; idempotency.

</DECISION_LOG>


<DEFINITION_OF_DONE>

Uma funcionalidade só pode ser chamada concluída quando:

- persistência funciona;
- validação existe;
- loading existe;
- empty state existe;
- erro é tratado;
- autorização funciona;
- RLS funciona;
- tenant isolation foi testado;
- AuditLog existe quando necessário;
- cálculo é reproduzível;
- idempotência foi avaliada;
- fluxo E2E funciona;
- testes críticos passam;
- dados históricos continuam explicáveis;
- não existe dado financeiro contraditório;
- engine version está registrada;
- CalculationRun está vinculado;
- evidências estão disponíveis.

Uma tela bonita não significa funcionalidade pronta.

</DEFINITION_OF_DONE>


<STOP_CONDITIONS>

Solicitar decisão humana somente quando:

1. houver risco de perda de dados;
2. migração destrutiva for necessária;
3. houver risco cross-tenant;
4. credenciais externas forem necessárias;
5. ação externa de escrita for necessária;
6. duas interpretações contratuais plausíveis produzirem valores materialmente diferentes;
7. ambiguidade financeira puder alterar cálculo significativamente;
8. mudança alterar HARD MVP SCOPE;
9. mudança transformar produto em ERP;
10. mudança transformar produto em billing;
11. decisão tiver impacto relevante de LGPD;
12. decisão comercial crítica não estiver definida.

Para decisões menores: usar padrão conservador; registrar no Decision Log; continuar.

</STOP_CONDITIONS>


<WARNINGS>

NÃO transformar em ERP.
NÃO construir CRM.
NÃO construir estoque.
NÃO construir contabilidade.
NÃO construir contas a pagar.
NÃO construir billing completo.
NÃO construir emissão fiscal.
NÃO construir chat prematuramente.
NÃO construir dezenas de findings.
NÃO começar integrações antes de validar engine.
NÃO utilizar IA como calculadora financeira.
NÃO ativar regra por IA automaticamente.
NÃO tratar divergência como perda confirmada.
NÃO apagar histórico.
NÃO sobrescrever versão.
NÃO utilizar float.
NÃO quebrar idempotência.
NÃO criar eventos duplicados.
NÃO gerar findings duplicados.
NÃO utilizar JSONB como banco financeiro improvisado.
NÃO permitir acesso cross-tenant.
NÃO armazenar senha de ERP.
NÃO inventar API.
NÃO inventar índice.
NÃO inventar dado fiscal.
NÃO inventar evidência.
NÃO modificar sistema externo no MVP.
NÃO fazer scope creep.

</WARNINGS>


<IMPLEMENTATION_ORDER>

Fase 1: Product Specification.
Fase 2: Domain Model.
Fase 3: Decision Log inicial.
Fase 4: Database Schema.
Fase 5: Auth.
Fase 6: Organizations.
Fase 7: Membership e permissions.
Fase 8: RLS.
Fase 9: Customers.
Fase 10: Contracts.
Fase 11: Contract Versions.
Fase 12: Documents e Storage.
Fase 13: Contract Intelligence.
Fase 14: Rule Review.
Fase 15: Imports.
Fase 16: Entity Resolution.
Fase 17: Operational Events.
Fase 18: Billing Events.
Fase 19: Money primitives.
Fase 20: Expected Revenue Engine.
Fase 21: Financial invariants.
Fase 22: CalculationRun.
Fase 23: Engine Versioning.
Fase 24: Reconciliation.
Fase 25: Materiality.
Fase 26: Findings.
Fase 27: Evidence Chain.
Fase 28: Finding Workflow.
Fase 29: Reprocessing.
Fase 30: Dashboard.
Fase 31: Audit UI.
Fase 32: Automated Tests.
Fase 33: E2E Tests.
Fase 34: Security Hardening.
Fase 35: Seed Demo.

Não inverter essa ordem para construir UI vistosa antes do núcleo.

</IMPLEMENTATION_ORDER>


<PHASE_RETURN_FORMAT>

Ao finalizar cada fase relevante, informar:

IMPLEMENTADO
PENDENTE
TESTES EXECUTADOS
DECISÕES TOMADAS
RISCOS IDENTIFICADOS
DÉBITOS TÉCNICOS
PRÓXIMA ETAPA.

Não responder apenas: "Pronto."

Explicar objetivamente o que foi realmente implementado.

</PHASE_RETURN_FORMAT>


<FIRST_TASK>

Antes de escrever código:

1. ler este MASTER_SPEC integralmente;
2. produzir resumo executivo;
3. apresentar Product Specification;
4. apresentar Domain Model;
5. apresentar ERD conceitual;
6. apresentar schema PostgreSQL inicial;
7. apresentar política monetária;
8. apresentar política de arredondamento;
9. apresentar política de competência;
10. apresentar arquitetura de tenancy;
11. apresentar estratégia RLS;
12. apresentar Contract Versioning;
13. apresentar CalculationRun;
14. apresentar Engine Versioning;
15. apresentar estratégia de idempotência;
16. apresentar estratégia de reprocessamento;
17. apresentar fluxo canônico ponta a ponta;
18. apresentar backlog;
19. apresentar testes obrigatórios;
20. apresentar riscos;
21. confirmar explicitamente: "NÃO ULTRAPASSAREI O HARD MVP SCOPE."

Depois: iniciar implementação seguindo IMPLEMENTATION_ORDER.

</FIRST_TASK>


<SUCCESS_CRITERIA>

O MVP só será considerado funcional quando o seguinte fluxo estiver real e conectado:

Contrato PDF → Upload privado → Extração → IA identifica regra → Usuário revisa → Usuário confirma → Regra ativa → Upload operacional → OperationalEvent → Upload de faturamento → BillingEvent → Expected Revenue Engine → CalculationRun → ExpectedRevenueEvent → ExpectedRevenueComponents → Financial Invariants → Reconciliation → Materiality → Finding OPEN → Evidence Chain → Human Review → Classification → FindingAction → AuditLog.

Exemplo:

Contrato: R$ 18.000/mês. Franquia: 40 horas. Uso: 57 horas. Excedente: 17 horas. Preço: R$ 280/h.
Expected: R$ 22.760. Billed: R$ 18.000. Difference: R$ 4.760.

Resultado: "Possível receita não faturada: R$ 4.760."

Evidências: contrato; cláusula; regra; evento; cálculo; faturamento.

CalculationRun: registrado. Engine version: registrada. Finding: OPEN. Classificação: humana. AuditLog: registrado.

Se esse fluxo não estiver funcionando ponta a ponta:

O MVP NÃO ESTÁ PRONTO.

</SUCCESS_CRITERIA>


<FINAL_PRODUCT_PHILOSOPHY>

O produto não existe para gerar centenas de alertas.

Existe para gerar poucos findings em que o usuário consiga confiar.

O produto não existe para impressionar com IA.

Existe para encontrar inconsistências financeiras reais.

O produto não existe para substituir os sistemas utilizados pela empresa.

Existe para verificar se esses sistemas, contratos e operações estão financeiramente coerentes.

O ativo central do produto não será: o dashboard; o chatbot; o design; a integração.

O ativo central será:

A CAPACIDADE DE TRANSFORMAR REGRAS CONTRATUAIS E FATOS OPERACIONAIS EM RECEITA ESPERADA REPRODUZÍVEL E COMPARÁ-LA COM O FATURAMENTO REAL, PRODUZINDO FINDINGS AUDITÁVEIS.

Tudo que não contribuir para isso deve ser secundário no MVP.

</FINAL_PRODUCT_PHILOSOPHY>

</MASTER_SPEC>
