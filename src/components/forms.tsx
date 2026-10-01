"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  data?: Record<string, unknown>;
}

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** Formulário ligado a Server Action: estado de envio, erro e confirmação sempre visíveis. */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = "Processando…",
  variant = "primary",
  className = "",
  resetOnSuccess = false,
  confirmMessage,
  inline = false,
}: {
  action: Action;
  children?: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
  resetOnSuccess?: boolean;
  confirmMessage?: string;
  inline?: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      action={formAction}
      className={`${inline ? "inline-flex flex-wrap items-end gap-2" : "space-y-3"} ${className}`}
      onSubmit={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) e.preventDefault();
      }}
    >
      {children}
      <div className={inline ? "" : "flex items-center gap-3"}>
        <SubmitButton label={submitLabel} pendingLabel={pendingLabel} variant={variant} />
      </div>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      {state.ok && state.message && <p role="status" className="text-sm text-good">{state.message}</p>}
    </form>
  );
}

export function SubmitButton({ label, pendingLabel, variant = "primary" }: { label: string; pendingLabel: string; variant?: "primary" | "secondary" | "danger" }) {
  const { pending } = useFormStatus();
  const cls = {
    primary: "bg-brand text-white hover:bg-brand-2",
    secondary: "border border-line bg-paper text-ink hover:bg-slate-50",
    danger: "border border-bad/40 bg-paper text-bad hover:bg-bad-soft",
  }[variant];
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-wait disabled:opacity-60 ${cls}`}>
      {pending ? pendingLabel : label}
    </button>
  );
}
