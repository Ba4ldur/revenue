import Link from "next/link";
import { formatBRL, formatQuantity, formatUnitPrice } from "@/domain/money/decimal";
import { formatCompetence, formatDateBR } from "@/domain/competence";
import { FINDING_STATUS_LABELS } from "@/domain/findings/labels";
import { FINDING_TYPE_LABELS, type FindingType } from "@/domain/reconciliation/reconciliation-engine";

export function PageHeader({ title, subtitle, actions, crumbs }: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  crumbs?: Array<{ href: string; label: string }>;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
      <div className="min-w-0">
        {crumbs && (
          <nav className="mb-1 text-xs text-ink-3" aria-label="Navegação">
            {crumbs.map((c, i) => (
              <span key={c.href}>
                {i > 0 && " / "}
                <Link className="hover:underline" href={c.href}>{c.label}</Link>
              </span>
            ))}
          </nav>
        )}
        <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-ink-3">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, description, children, actions }: { title: string; description?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-md border border-line bg-paper">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-ink-3">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line px-4 py-8 text-center">
      <p className="text-sm font-medium text-ink-2">{title}</p>
      {children && <div className="mt-1 text-sm text-ink-3">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "bad" | "good"; children: React.ReactNode }) {
  const cls = {
    info: "border-brand/20 bg-brand-soft text-brand-2",
    warn: "border-warn/30 bg-warn-soft text-warn",
    bad: "border-bad/30 bg-bad-soft text-bad",
    good: "border-good/30 bg-good-soft text-good",
  }[tone];
  return <div role={tone === "bad" ? "alert" : "status"} className={`mb-4 rounded-md border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

export function Money({ value, className = "" }: { value: string | null | undefined; className?: string }) {
  if (value === null || value === undefined) return <span className="text-ink-3">—</span>;
  return <span className={`num whitespace-nowrap ${className}`}>{formatBRL(value)}</span>;
}

export function UnitPrice({ value }: { value: string | null | undefined }) {
  if (value === null || value === undefined) return <span className="text-ink-3">—</span>;
  return <span className="num whitespace-nowrap">{formatUnitPrice(value)}</span>;
}

export function Qty({ value, unit }: { value: string | null | undefined; unit?: string | null }) {
  if (value === null || value === undefined) return <span className="text-ink-3">—</span>;
  return <span className="num whitespace-nowrap">{formatQuantity(value)}{unit ? ` ${unit}` : ""}</span>;
}

export const Comp = ({ value }: { value: string | null | undefined }) => <span className="num">{value ? formatCompetence(value) : "—"}</span>;
export const DateBR = ({ value }: { value: string | null | undefined }) => <span className="num">{formatDateBR(value)}</span>;
export const DateTime = ({ value }: { value: string | Date | null | undefined }) =>
  value ? <span className="num whitespace-nowrap">{new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span> : <span>—</span>;

const TONES: Record<string, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  brand: "bg-brand-soft text-brand-2 ring-brand/20",
  warn: "bg-warn-soft text-warn ring-warn/30",
  bad: "bg-bad-soft text-bad ring-bad/30",
  good: "bg-good-soft text-good ring-good/30",
};

export function Badge({ tone = "neutral", children, title }: { tone?: keyof typeof TONES; children: React.ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>{children}</span>;
}

const STATUS_TONE: Record<string, keyof typeof TONES> = {
  OPEN: "warn", UNDER_REVIEW: "brand", CONFIRMED: "bad", JUSTIFIED: "neutral", FALSE_POSITIVE: "neutral", DISCARDED: "neutral", RECOVERED: "good",
  ACTIVE: "good", PROPOSED: "warn", REJECTED: "neutral", SUPERSEDED: "neutral", DRAFT: "neutral", SUSPENDED: "warn", TERMINATED: "neutral",
  COMPLETED: "good", COMPLETED_WITH_ERRORS: "warn", NEEDS_REVIEW: "warn", FAILED: "bad", DUPLICATE: "neutral", MAPPING_REQUIRED: "brand",
  RUNNING: "brand", PENDING: "neutral", INVITED: "brand", DISABLED: "neutral", MATCHED: "good", UNMATCHED: "bad",
  IMPORTED: "good", VALID: "brand", INVALID: "bad", PENDING_MATCH: "warn", CONFLICT: "bad",
};
const STATUS_LABEL: Record<string, string> = {
  ...FINDING_STATUS_LABELS,
  ACTIVE: "Ativa", PROPOSED: "Proposta", CONFIRMED: FINDING_STATUS_LABELS.CONFIRMED!, REJECTED: "Rejeitada", SUPERSEDED: "Substituída",
  DRAFT: "Rascunho", SUSPENDED: "Suspenso", TERMINATED: "Encerrado", COMPLETED: "Concluído", COMPLETED_WITH_ERRORS: "Concluído c/ erros",
  NEEDS_REVIEW: "Requer revisão", FAILED: "Falhou", DUPLICATE: "Duplicado", MAPPING_REQUIRED: "Mapear colunas", RUNNING: "Executando",
  PENDING: "Pendente", INVITED: "Convidado", DISABLED: "Desativado", MATCHED: "Vinculado", UNMATCHED: "Sem vínculo",
  IMPORTED: "Importada", VALID: "Válida", INVALID: "Inválida", PENDING_MATCH: "Aguardando vínculo", CONFLICT: "Conflito",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{label ?? STATUS_LABEL[status] ?? status}</Badge>;
}

export function FindingTypeLabel({ type }: { type: string }) {
  return <>{FINDING_TYPE_LABELS[type as FindingType] ?? type}</>;
}

export function Table({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto"><table className="w-full text-sm">{children}</table></div>;
}
export function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <th className={`border-b border-line px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-3 ${right ? "text-right" : "text-left"}`}>{children}</th>;
}
export function Td({ children, right, mono, className = "" }: { children?: React.ReactNode; right?: boolean; mono?: boolean; className?: string }) {
  return <td className={`border-b border-line px-3 py-2 align-top ${right ? "text-right" : ""} ${mono ? "font-mono text-xs" : ""} ${className}`}>{children}</td>;
}

export function KeyValue({ items }: { items: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-ink-3">{k}</dt>
          <dd className="truncate">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function LinkButton({ href, children, variant = "secondary" }: { href: string; children: React.ReactNode; variant?: "primary" | "secondary" }) {
  const cls = variant === "primary" ? "bg-brand text-white hover:bg-brand-2" : "border border-line bg-paper text-ink hover:bg-slate-50";
  return <Link href={href} className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium ${cls}`}>{children}</Link>;
}

export const inputCls = "w-full rounded-md border border-line bg-paper px-2.5 py-1.5 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}
