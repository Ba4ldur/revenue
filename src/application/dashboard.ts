import { requirePermission, userTx, type OrgContext } from "./context";

/**
 * Indicadores somente a partir de execuções correntes (runs COMPLETED). Todo número tem
 * origem rastreável: cada linha agregada aponta para findings/contratos navegáveis.
 * Somas são feitas em SQL numeric (sem float); valores retornam como string.
 */
export async function getDashboard(ctx: OrgContext, opts: { from?: string | null; until?: string | null } = {}) {
  const from = opts.from ?? null;
  const until = opts.until ?? null;
  return userTx(ctx, async (tx) => {
    const [monitored] = await tx`
      select coalesce(sum(e.expected_total), 0)::numeric(18,2)::text as total, count(*)::int as scopes,
        count(distinct e.contract_id)::int as contracts, min(e.competence) as first_competence, max(e.competence) as last_competence
      from app.expected_revenue_events e join app.calculation_runs r on r.id = e.calculation_run_id
      where e.organization_id = ${ctx.orgId} and r.status = 'COMPLETED'
        and (${from}::date is null or e.competence >= ${from}) and (${until}::date is null or e.competence <= ${until})`;
    const current = tx`
      select f.* from app.findings f join app.calculation_runs r on r.id = f.calculation_run_id
      where f.organization_id = ${ctx.orgId} and r.status = 'COMPLETED'
        and (${from}::date is null or f.competence >= ${from}) and (${until}::date is null or f.competence <= ${until})`;
    const byStatus = await tx`
      select f.status, count(*)::int as n, coalesce(sum(f.difference_amount), 0)::text as amount,
        coalesce(sum(f.recovered_amount), 0)::text as recovered
      from (${current}) f group by f.status order by f.status`;
    const byType = await tx`
      select f.finding_type, count(*)::int as n, coalesce(sum(f.difference_amount), 0)::text as amount
      from (${current}) f where f.status in ('OPEN', 'UNDER_REVIEW', 'CONFIRMED') group by f.finding_type order by amount::numeric desc`;
    const top = await tx`
      select f.id, f.finding_type, f.status, f.competence, f.difference_amount, k.contract_number, coalesce(c.trade_name, c.legal_name) as customer_name
      from (${current}) f join app.contracts k on k.id = f.contract_id join app.customers c on c.id = f.customer_id
      where f.status in ('OPEN', 'UNDER_REVIEW') order by f.difference_amount desc limit 5`;
    const recent = await tx`
      select f.id, f.finding_type, f.status, f.competence, f.difference_amount, f.detected_at, k.contract_number,
        coalesce(c.trade_name, c.legal_name) as customer_name
      from (${current}) f join app.contracts k on k.id = f.contract_id join app.customers c on c.id = f.customer_id
      order by f.detected_at desc limit 5`;
    const contracts = await tx`
      select k.id, k.contract_number, coalesce(c.trade_name, c.legal_name) as customer_name, count(*)::int as n,
        sum(f.difference_amount)::text as amount
      from (${current}) f join app.contracts k on k.id = f.contract_id join app.customers c on c.id = f.customer_id
      where f.status in ('OPEN', 'UNDER_REVIEW', 'CONFIRMED') group by k.id, k.contract_number, c.trade_name, c.legal_name
      order by sum(f.difference_amount) desc limit 5`;
    const [needsReview] = await tx`
      select count(*)::int as n from (
        select distinct on (contract_id, competence) status from app.calculation_runs
        where organization_id = ${ctx.orgId} order by contract_id, competence, created_at desc) x
      where x.status = 'FAILED'`;
    const status = (s: string) => byStatus.find((r) => r.status === s);
    const sumOf = (ss: string[]) => ss.reduce((acc, s) => acc + (status(s)?.n ?? 0), 0);
    const classified = sumOf(["CONFIRMED", "JUSTIFIED", "FALSE_POSITIVE", "DISCARDED", "RECOVERED"]);
    return {
      monitored: monitored!,
      open: { n: sumOf(["OPEN", "UNDER_REVIEW"]), amountOpen: status("OPEN")?.amount ?? "0", amountReview: status("UNDER_REVIEW")?.amount ?? "0" },
      confirmed: { n: status("CONFIRMED")?.n ?? 0, amount: status("CONFIRMED")?.amount ?? "0" },
      recovered: { n: status("RECOVERED")?.n ?? 0, amount: status("RECOVERED")?.recovered ?? "0" },
      falsePositive: { n: status("FALSE_POSITIVE")?.n ?? 0, classified },
      byStatus, byType, top, recent, contracts,
      scopesNeedingReview: needsReview!.n as number,
    };
  });
}

export async function listAuditLogs(ctx: OrgContext, f: { entityType?: string | null; action?: string | null; page?: number } = {}) {
  requirePermission(ctx, "audit.read");
  const page = Math.max(0, f.page ?? 0);
  return userTx(ctx, (tx) => tx`
    select a.id, a.action, a.entity_type, a.entity_id, a.actor_type, a.created_at, a.metadata, a.before_data, a.after_data,
      u.email as actor_email
    from app.audit_logs a left join app.users u on u.id = a.actor_user_id
    where a.organization_id = ${ctx.orgId}
      and (${f.entityType ?? null}::text is null or a.entity_type = ${f.entityType ?? null})
      and (${f.action ?? null}::text is null or a.action ilike ${f.action ? `%${f.action}%` : null})
    order by a.created_at desc, a.id limit 100 offset ${page * 100}`);
}
