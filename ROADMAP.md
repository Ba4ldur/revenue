# ROADMAP

Registro de ideias e evoluções **fora** do MVP 1. Nada aqui deve ser implementado antes de o
fluxo canônico estar validado com operações reais (MVP_SUCCESS_CRITERIA).

| Marco | Conteúdo | Pré-condição |
|---|---|---|
| MVP 0 | Auditoria concierge com 5 empresas | — (pode correr em paralelo ao MVP 1) |
| MVP 1 | Contratos, regras, operação, faturamento, expected revenue, reconciliação, findings, evidências | em implementação |
| MVP 2 | Conectores read-only (Omie, Conta Azul, Bling, Asaas) via interface `Connector` | MVP 1 validado; documentação oficial vigente consultada |
| MVP 3 | Monitoramento contínuo (execução agendada) | MVP 2 |
| MVP 4 | Recebimentos (FATURADO → RECEBIDO) | MVP 3 |
| MVP 5 | Preparação de correção (rascunho, sem escrita externa) | MVP 4 |
| MVP 6 | Ações externas aprovadas | MVP 5 + aprovação humana |
| MVP 7 | Revenue & Margin Assurance | — |

## Ideias registradas durante a implementação (não aprovadas)
- Pró-rata de versões que mudam no meio do mês (hoje: NEEDS_REVIEW).
- OCR para contratos escaneados.
- Parser de XML NFS-e (Padrão Nacional / ABRASF) — depende de schema oficial e amostras.
- Notas de crédito e cancelamentos no faturamento.
- Fila de jobs dedicada quando volume de imports justificar.
- Segregação de funções (quem confirma regra ≠ quem a propôs) como opção por organização.
