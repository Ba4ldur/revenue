export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="animate-pulse space-y-3">
      <div className="h-6 w-56 rounded bg-slate-200" />
      <div className="h-4 w-96 rounded bg-slate-200" />
      <div className="h-40 rounded bg-slate-200" />
      <span className="sr-only">Carregando…</span>
    </div>
  );
}
