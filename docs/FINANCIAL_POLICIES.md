# Políticas financeiras e cadastrais — comportamento atual

Documento descritivo: registra **o que o sistema faz hoje** e o que **não foi verificado em fonte
oficial**. Não cria regra nova. Mudança de comportamento de cálculo exige nova versão de motor (ADR-007).

## 1. Arredondamento (expected_revenue_engine 1.0.0)

### O que acontece
| Etapa | Precisão | Arredondamento |
|---|---|---|
| Valores monetários de regra (mensalidade, desconto fixo) | 2 casas | nenhum — entrada com mais casas é **rejeitada** (banco e aplicação) |
| Preço unitário de excedente | até 6 casas | nenhum — entrada com mais casas é **rejeitada** |
| Quantidades (eventos, franquia) | até 6 casas | nenhum — entrada com mais casas é **rejeitada** |
| Valores de faturamento importados | 2 casas | nenhum — linha com mais casas fica **inválida** |
| Soma de uso, excedente (`max(0, uso − franquia)`) | exata | nenhum |
| **Valor de cada componente** (`excedente × preço`) | 2 casas | **ROUND_HALF_UP** (meio para longe de zero), uma única vez |
| Receita esperada | soma exata dos componentes já arredondados | nenhum |
| Diferença (`esperado − faturado`) | exata | nenhum |
| Razão para materialidade e severidade | precisão interna de 40 dígitos | comparação sem arredondar; gravada com 8 casas só para exibição |
| Exibição em R$ | 2 casas | apenas formatação (valores já têm 2 casas) |

Exemplos (cobertos por testes): 17 h × R$ 280,00 = R$ 4.760,00; 0,5 h × R$ 0,01 = R$ 0,005 → **R$ 0,01**;
0,1 h + 0,2 h a R$ 100,00 = R$ 30,00 (sem erro de ponto flutuante — nenhum valor passa por `float`).

### O que NÃO foi verificado
- Não localizei norma que imponha um modo de arredondamento para este cálculo gerencial de receita
  esperada. HALF_UP foi escolhido por ser o arredondamento comercial usual; **não** é afirmado como
  exigência legal. A ABNT NBR 5891 trata de regras de arredondamento, mas seu texto e sua aplicabilidade
  **não foram verificados**. Confirmar com contador (ADR-003, "Requer confirmação").
- Regras de arredondamento **definidas no próprio contrato** (ex.: "fração de hora cobrada como hora
  cheia", "franquia não cumulativa", mínimo de faturamento por chamado) **não são aplicadas** pelo motor
  1.0.0. Se o contrato real tiver cláusula assim, o resultado do motor pode divergir do faturamento
  correto: classifique como JUSTIFIED/FALSE_POSITIVE e registre o caso para o backlog.
- Tributos (ISS, retenções) não entram no cálculo: o valor esperado é o **valor bruto do serviço**; o
  faturamento importado deve ser o bruto da NF.

## 2. CNPJ alfanumérico

### Implementação atual (sem alteração nesta etapa)
- Formato aceito: 12 posições `[0-9A-Z]` + 2 dígitos verificadores numéricos; entrada normalizada para
  maiúsculas sem `.`, `/`, `-` e espaços. Rejeita 14 dígitos repetidos.
- DV: cada caractere vale (código ASCII − 48) — dígitos mantêm o valor, `A`=17 … `Z`=42; pesos
  `5,4,3,2,9,8,7,6,5,4,3,2` (1º DV) e `6,5,4,3,2,9,8,7,6,5,4,3,2` (2º DV); resto da divisão por 11 menor
  que 2 ⇒ 0, senão 11 − resto. Mesmo algoritmo em TypeScript (`src/domain/cnpj.ts`) e SQL
  (`app.is_valid_cnpj`). CNPJs numéricos existentes continuam válidos com o mesmo cálculo.
- Exemplo usado nos testes: `12.ABC.345/01DE-35` (válido).

### Situação da verificação em fonte oficial (2026-10-01)
- Tentei acessar a fonte oficial — documento "CNPJ alfanumérico" (perguntas e respostas) da Receita
  Federal em `gov.br`, o material do Serpro sobre cálculo do DV e o anexo da norma em
  `normas.receita.fazenda.gov.br` — e **todos estão bloqueados pela política de rede do ambiente de
  desenvolvimento**. A verificação oficial **não foi concluída**.
- Resultados de busca (fontes secundárias) descrevem a mesma regra implementada (ASCII − 48, pesos
  acima, módulo 11, 12 posições alfanuméricas + 2 DV numéricos), atribuem a mudança à IN RFB nº 2.229/2024
  (alterando a IN RFB nº 2.119/2022) com início em julho de 2026, e citam `12.ABC.345/01DE-35` como
  exemplo. Isso **corrobora**, mas não substitui a leitura do documento oficial.
- Por isso a regra **não foi alterada**. Pendência: ler o documento oficial e conferir pelo menos um
  exemplo oficial com DV antes do uso em produção com CNPJs alfanuméricos reais.
