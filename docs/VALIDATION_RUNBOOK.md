# Roteiro do primeiro teste real ponta a ponta

Objetivo: verificar, com **1 contrato PDF real, 1 arquivo operacional real e 1 arquivo real de
faturamento**, se o sistema chega ao mesmo resultado que uma conferência manual feita por quem conhece
o contrato (MVP 0 / concierge). O critério de sucesso não é "achar divergência", é **o resultado ser
correto e explicável**.

## 0. Pré-requisitos
- Ambiente: local (`supabase start` + `npm run dev`) ou hospedado (ver `PRODUCTION.md`).
- `npm run check:env` sem erros. Para extração real: `AI_PROVIDER=anthropic` e `ANTHROPIC_API_KEY`
  definidos **no ambiente** (nunca no código, nunca em mensagem/chat).
- Autorização para enviar o contrato ao provedor de IA (LGPD/sigilo — `PRODUCTION.md` §4). Sem ela:
  pule a etapa 2 e cadastre as regras manualmente com o trecho do contrato.

## 1. O que preparar (arquivos)

### 1.1 Contrato PDF
- PDF **com texto selecionável** (não escaneado). Teste: conseguir copiar um trecho do PDF.
- Até 20 MB.
- Com cláusulas mensuráveis do tipo suportado pelo motor 1.0.0:
  - mensalidade fixa;
  - quantidade incluída (franquia) por unidade (horas, chamados, visitas, usuários…);
  - preço do excedente por unidade;
  - (opcional) desconto fixo em R$.
- Não suportado (o cálculo fica "requer revisão" ou a cláusula é ignorada como informativa):
  reajuste por índice, desconto percentual, pró-rata, troca de valor no meio do mês, mais de uma
  franquia para a mesma unidade, regras de arredondamento de fração de hora.
- Útil informar à parte: a vigência do contrato e se houve aditivo.

### 1.2 Arquivo operacional (CSV ou XLSX)
- Até 10 MB e 20.000 linhas; cabeçalho na 1ª linha; no XLSX, dados na 1ª planilha; fórmulas
  precisam ter valor calculado salvo.
- Uma linha por fato executado (apontamento de horas, chamado, visita…), com colunas:
  | Necessária | Coluna |
  |---|---|
  | sim | identificação do cliente: **CNPJ** (preferível) ou razão social ou código do cliente no sistema de origem |
  | sim | **competência** (MM/AAAA) **ou** data (DD/MM/AAAA) |
  | sim | **quantidade** (horas/unidades), número no formato brasileiro (1.234,5) ou internacional — escolhido no mapeamento |
  | se houver | unidade (ou uma unidade fixa para o arquivo todo) |
  | se o cliente tiver mais de um contrato | número do contrato |
  | recomendada | identificador do apontamento (nº da OS/chamado) — evita deduplicar linhas iguais legítimas entre arquivos |
  | opcional | descrição |
- Cobrir as mesmas competências do faturamento (idealmente 3 meses).

### 1.3 Arquivo de faturamento (CSV ou XLSX)
- Mesmos limites. Uma linha por NF (ou item de NF):
  | Necessária | Coluna |
  |---|---|
  | sim | identificação do cliente (**CNPJ** preferível) |
  | sim | **data de emissão** (DD/MM/AAAA) |
  | sim | **valor bruto do serviço** (antes de retenções), positivo |
  | sim | **competência** (MM/AAAA) **ou** decisão explícita "competência = mês da emissão − N" |
  | recomendada | número da NF (e série, se houver) |
  | se o cliente tiver mais de um contrato | número do contrato |
- Remova antes: notas canceladas e notas de crédito (valores negativos são rejeitados no MVP).
- XML de NFS-e/NF-e **não** é aceito no MVP (ADR-012).

### 1.4 Conferência manual (essencial)
Uma planilha simples, feita por quem conhece o contrato, com, por competência: mensalidade, franquia,
uso, excedente, valor esperado, valor faturado e diferença. É contra ela que o resultado será julgado.

## 2. Validar a extração antes de gravar (opcional, recomendado)
```bash
npm run validate:extraction -- caminho/contrato.pdf
```
Mostra páginas com texto, regras propostas, itens descartados e se cada trecho foi localizado
literalmente. Nada é gravado. Se o PDF não tiver texto, use cadastro manual.

## 3. Execução na aplicação
1. Configurações → Materialidade: confirmar a política (padrão R$ 500 **AND** 1%).
2. Clientes: cadastrar o cliente com CNPJ.
3. Contratos: criar contrato com a vigência real → anexar o PDF (upload direto ao armazenamento).
4. Regras: "Extrair regras" → conferir **cada** valor, página e trecho contra o PDF → confirmar
   (ajustando se necessário) ou rejeitar → ativar. Regras sem trecho verificado não podem ser confirmadas.
5. Importações → operacional: enviar → conferir sugestão de mapeamento → **pré-visualizar** →
   processar. Resolver vínculos de cliente pendentes, se houver.
6. Importações → faturamento: idem; escolher explicitamente a regra de competência.
7. Contrato → "Calcular competência" para cada mês.
8. Divergências: abrir cada uma e conferir memória de cálculo, evidências e faturamento; classificar.

## 4. O que registrar (resultado do teste)
| Pergunta | Registro |
|---|---|
| A extração encontrou todas as regras monetárias? Algum valor errado? | por regra |
| Algum trecho não foi localizado? | por regra |
| Quantas linhas inválidas/duplicadas/pendentes nos imports e por quê | por import |
| Por competência: esperado/faturado/diferença do sistema × planilha manual | tabela |
| Alguma competência ficou "requer revisão"? Motivo | lista |
| Divergências: corretas, justificadas ou falsos positivos | por finding |
| Tempo total até o primeiro resultado | minutos |

Qualquer diferença entre sistema e planilha manual é o achado mais valioso do teste: registre-a com o
trecho do contrato e a linha do arquivo correspondente.
