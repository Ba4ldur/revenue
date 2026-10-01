import { assertUuid, can, userTx, type OrgContext } from "./context";

/**
 * Visão por competência de um contrato: resultado corrente (runs COMPLETED) e a tentativa
 * mais recente — se a última tentativa falhou/precisa de revisão, isso fica explícito.
 */
export async function contractCompetences(ctx: OrgContext, contractId: string) {
  assertUuid(contractId);
  return userTx(ctx, async (tx) => {
    const rows = await tx`
      with latest as (
        select distinct on (competence, calculation_type) competence, calculation_type, id, status, error_details, created_at
        from app.calculation_runs where contract_id = ${contractId} and organization_id = ${ctx.orgId}
        order by competence, calculation_type, created_at desc
      )
      select c.competence,
        e.expected_total, e.contract_version_id, v.version_number, er.id as expected_run_id, er.engine_version as expected_engine,
        rr.id as rec_run_id, rr.result_summary->>'billed_amount' as billed, rr.result_summary->>'difference_amount' as difference,
        rr.result_summary->>'outcome' as outcome, f.id as finding_id, f.status as finding_status,
        le.status as latest_expected_status, le.error_details as latest_expected_error,
        lr.status as latest_rec_status, lr.error_details as latest_rec_error
      from (select distinct competence from app.calculation_runs where contract_id = ${contractId} and organization_id = ${ctx.orgId}) c
      left join app.calculation_runs er on er.contract_id = ${contractId} and er.competence = c.competence and er.calculation_type = 'EXPECTED_REVENUE' and er.status = 'COMPLETED'
      left join app.expected_revenue_events e on e.calculation_run_id = er.id
      left join app.contract_versions v on v.id = e.contract_version_id
      left join app.calculation_runs rr on rr.parent_run_id = er.id and rr.status = 'COMPLETED'
      left join app.findings f on f.calculation_run_id = rr.id
      left join latest le on le.competence = c.competence and le.calculation_type = 'EXPECTED_REVENUE'
      left join latest lr on lr.competence = c.competence and lr.calculation_type = 'RECONCILIATION'
      order by c.competence desc`;
    return rows;
  });
}

export async function entityHistory(ctx: OrgContext, entityIds: string[]) {
  if (!can(ctx, "audit.read") || entityIds.length === 0) return null;
  return userTx(ctx, (tx) => tx`
    select a.id, a.action, a.entity_type, a.created_at, a.metadata->>'intent' as intent, a.actor_type, u.email as actor_email
    from app.audit_logs a left join app.users u on u.id = a.actor_user_id
    where a.organization_id = ${ctx.orgId} and a.entity_id in ${tx(entityIds)}
    order by a.created_at desc limit 50`);
}
