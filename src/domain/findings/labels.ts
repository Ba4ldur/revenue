/** Rótulos de estados e ações de findings (pt-BR). */
export const FINDING_STATUS_LABELS: Record<string, string> = {
  OPEN: "Aberto",
  UNDER_REVIEW: "Em revisão",
  CONFIRMED: "Confirmado",
  JUSTIFIED: "Justificado",
  FALSE_POSITIVE: "Falso positivo",
  DISCARDED: "Descartado",
  RECOVERED: "Recuperado",
};
export const ACTION_LABELS: Record<string, string> = {
  START_REVIEW: "Iniciar revisão",
  CONFIRM: "Confirmar divergência",
  JUSTIFY: "Justificar",
  MARK_FALSE_POSITIVE: "Marcar falso positivo",
  DISCARD: "Descartar",
  MARK_RECOVERED: "Registrar recuperação",
  REOPEN: "Reabrir",
  NOTE: "Anotação",
};

