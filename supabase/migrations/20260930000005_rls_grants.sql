-- =============================================================================
-- RLS e privilégios (ADR-010, matriz ADR-015).
-- Nenhuma política de DELETE: exclusão física é proibida.
-- Tabelas de saída de motor não têm escrita para `authenticated`.
-- =============================================================================

-- Privilégios de tabela ------------------------------------------------------------
grant select on all tables in schema app to authenticated;
grant select, insert, update on all tables in schema app to service_role;
revoke delete, truncate on all tables in schema app from authenticated, service_role;

grant update on app.organizations, app.users to authenticated;
grant insert, update on
  app.organization_users,
  app.customers, app.contracts, app.contract_versions, app.contract_documents,
  app.rule_extraction_runs, app.contract_rules,
  app.imports, app.import_rows, app.entity_matches,
  app.operational_events, app.billing_events,
  app.materiality_policies, app.reprocessing_jobs
to authenticated;
grant insert on app.contract_document_pages, app.invoices, app.finding_actions to authenticated;

-- audit_logs: ninguém escreve diretamente (somente triggers SECURITY DEFINER)
revoke insert, update on app.audit_logs from authenticated, service_role;
-- engine_registry: somente migrações
revoke insert, update on app.engine_registry from authenticated, service_role;
-- saídas de motor: somente service_role
revoke insert, update on
  app.calculation_runs, app.expected_revenue_events, app.expected_revenue_components,
  app.expected_revenue_component_sources, app.findings, app.finding_evidence
from authenticated;

-- Funções ------------------------------------------------------------------------
grant execute on all functions in schema app to authenticated, service_role;
revoke execute on function app.audit_row() from authenticated, service_role;
revoke execute on function app.handle_auth_user() from authenticated, service_role;
revoke execute on function app.finding_actions_apply() from authenticated, service_role;

-- Habilita RLS em todas as tabelas do schema app ----------------------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'app' loop
    execute format('alter table app.%I enable row level security', t.tablename);
  end loop;
end $$;

-- Organizações e pessoas -------------------------------------------------------------
create policy org_select on app.organizations for select to authenticated
  using (app.is_member(id));
create policy org_update on app.organizations for update to authenticated
  using (app.has_role(id, array['ADMIN'])) with check (app.has_role(id, array['ADMIN']));

create policy users_select on app.users for select to authenticated
  using (app.shares_organization(id));
create policy users_update_self on app.users for update to authenticated
  using (id = app.current_user_id()) with check (id = app.current_user_id());

create policy members_select on app.organization_users for select to authenticated
  using (app.is_member(organization_id));
create policy members_insert on app.organization_users for insert to authenticated
  with check (app.has_role(organization_id, array['ADMIN']) and status = 'INVITED');
create policy members_update on app.organization_users for update to authenticated
  using (app.has_role(organization_id, array['ADMIN']))
  with check (app.has_role(organization_id, array['ADMIN']));

create policy materiality_select on app.materiality_policies for select to authenticated
  using (app.is_member(organization_id));
create policy materiality_insert on app.materiality_policies for insert to authenticated
  with check (app.has_role(organization_id, array['ADMIN']));
create policy materiality_update on app.materiality_policies for update to authenticated
  using (app.has_role(organization_id, array['ADMIN']))
  with check (app.has_role(organization_id, array['ADMIN']));

create policy engine_registry_select on app.engine_registry for select to authenticated using (true);

create policy audit_select on app.audit_logs for select to authenticated
  using (organization_id is not null and app.has_role(organization_id, array['ADMIN', 'AUDITOR']));

-- Clientes, contratos, versões --------------------------------------------------------
create policy customers_select on app.customers for select to authenticated
  using (app.is_member(organization_id));
create policy customers_insert on app.customers for insert to authenticated
  with check (app.has_role(organization_id, array['ADMIN', 'COMMERCIAL']));
create policy customers_update on app.customers for update to authenticated
  using (app.has_role(organization_id, array['ADMIN', 'COMMERCIAL']))
  with check (app.has_role(organization_id, array['ADMIN', 'COMMERCIAL']));

create policy contracts_select on app.contracts for select to authenticated
  using (app.is_member(organization_id));
create policy contracts_insert on app.contracts for insert to authenticated
  with check (app.has_role(organization_id, array['ADMIN', 'COMMERCIAL']));
create policy contracts_update on app.contracts for update to authenticated
  using (app.has_role(organization_id, array['ADMIN', 'COMMERCIAL']))
  with check (app.has_role(organization_id, array['ADMIN', 'COMMERCIAL']));

create policy versions_select on app.contract_versions for select to authenticated
  using (app.is_member(organization_id));
create policy versions_insert on app.contract_versions for insert to authenticated
  with check (app.has_role(organization_id, array['ADMIN', 'COMMERCIAL']));
create policy versions_update on app.contract_versions for update to authenticated
  using (app.has_role(organization_id, array['ADMIN', 'COMMERCIAL']))
  with check (app.has_role(organization_id, array['ADMIN', 'COMMERCIAL']));

-- Documentos e texto -----------------------------------------------------------------
create policy documents_select on app.contract_documents for select to authenticated
  using (app.is_member(organization_id));
create policy documents_insert on app.contract_documents for insert to authenticated
  with check (app.has_role(organization_id, array['ADMIN', 'COMMERCIAL']) and uploaded_by = app.current_user_id());
create policy documents_update on app.contract_documents for update to authenticated
  using (app.has_role(organization_id, array['ADMIN', 'COMMERCIAL']))
  with check (app.has_role(organization_id, array['ADMIN', 'COMMERCIAL']));

create policy pages_select on app.contract_document_pages for select to authenticated
  using (app.has_role(organization_id, array['ADMIN', 'COMMERCIAL', 'FINANCE', 'AUDITOR']));
create policy pages_insert on app.contract_document_pages for insert to authenticated
  with check (app.has_role(organization_id, array['ADMIN', 'COMMERCIAL']));

create policy extraction_select on app.rule_extraction_runs for select to authenticated
  using (app.has_role(organization_id, array['ADMIN', 'COMMERCIAL', 'AUDITOR']));
create policy extraction_insert on app.rule_extraction_runs for insert to authenticated
  with check (app.has_role(organization_id, array['ADMIN', 'COMMERCIAL']));
create policy extraction_update on app.rule_extraction_runs for update to authenticated
  using (app.has_role(organization_id, array['ADMIN', 'COMMERCIAL']))
  with check (app.has_role(organization_id, array['ADMIN', 'COMMERCIAL']));

-- Regras: COMMERCIAL propõe; somente ADMIN revisa (confirma/rejeita/ativa/substitui).
create policy rules_select on app.contract_rules for select to authenticated
  using (app.is_member(organization_id));
create policy rules_insert on app.contract_rules for insert to authenticated
  with check (app.has_role(organization_id, array['ADMIN', 'COMMERCIAL']) and status = 'PROPOSED');
create policy rules_update on app.contract_rules for update to authenticated
  using (app.has_role(organization_id, array['ADMIN']))
  with check (app.has_role(organization_id, array['ADMIN']));

-- Imports e resolução -----------------------------------------------------------------
create policy imports_select on app.imports for select to authenticated
  using (app.has_role(organization_id, array['ADMIN', 'FINANCE', 'AUDITOR']));
create policy imports_insert on app.imports for insert to authenticated
  with check (app.has_role(organization_id, array['ADMIN', 'FINANCE']) and uploaded_by = app.current_user_id());
create policy imports_update on app.imports for update to authenticated
  using (app.has_role(organization_id, array['ADMIN', 'FINANCE']))
  with check (app.has_role(organization_id, array['ADMIN', 'FINANCE']));

create policy import_rows_select on app.import_rows for select to authenticated
  using (app.has_role(organization_id, array['ADMIN', 'FINANCE', 'AUDITOR']));
create policy import_rows_insert on app.import_rows for insert to authenticated
  with check (app.has_role(organization_id, array['ADMIN', 'FINANCE']));
create policy import_rows_update on app.import_rows for update to authenticated
  using (app.has_role(organization_id, array['ADMIN', 'FINANCE']))
  with check (app.has_role(organization_id, array['ADMIN', 'FINANCE']));

create policy matches_select on app.entity_matches for select to authenticated
  using (app.has_role(organization_id, array['ADMIN', 'FINANCE', 'AUDITOR']));
create policy matches_insert on app.entity_matches for insert to authenticated
  with check (app.has_role(organization_id, array['ADMIN', 'FINANCE']));
create policy matches_update on app.entity_matches for update to authenticated
  using (app.has_role(organization_id, array['ADMIN', 'FINANCE']))
  with check (app.has_role(organization_id, array['ADMIN', 'FINANCE']));

-- Eventos (leitura para todos os membros: compõem a evidência dos findings) -------------
create policy op_events_select on app.operational_events for select to authenticated
  using (app.is_member(organization_id));
create policy op_events_insert on app.operational_events for insert to authenticated
  with check (app.has_role(organization_id, array['ADMIN', 'FINANCE']));
create policy op_events_update on app.operational_events for update to authenticated
  using (app.has_role(organization_id, array['ADMIN', 'FINANCE']))
  with check (app.has_role(organization_id, array['ADMIN', 'FINANCE']));

create policy invoices_select on app.invoices for select to authenticated
  using (app.is_member(organization_id));
create policy invoices_insert on app.invoices for insert to authenticated
  with check (app.has_role(organization_id, array['ADMIN', 'FINANCE']));

create policy billing_events_select on app.billing_events for select to authenticated
  using (app.is_member(organization_id));
create policy billing_events_insert on app.billing_events for insert to authenticated
  with check (app.has_role(organization_id, array['ADMIN', 'FINANCE']));
create policy billing_events_update on app.billing_events for update to authenticated
  using (app.has_role(organization_id, array['ADMIN', 'FINANCE']))
  with check (app.has_role(organization_id, array['ADMIN', 'FINANCE']));

-- Cálculo, findings, evidências (somente leitura para usuários) ------------------------
create policy runs_select on app.calculation_runs for select to authenticated
  using (app.is_member(organization_id));
create policy ere_select on app.expected_revenue_events for select to authenticated
  using (app.is_member(organization_id));
create policy erc_select on app.expected_revenue_components for select to authenticated
  using (app.is_member(organization_id));
create policy ercs_select on app.expected_revenue_component_sources for select to authenticated
  using (app.is_member(organization_id));
create policy findings_select on app.findings for select to authenticated
  using (app.is_member(organization_id));
create policy evidence_select on app.finding_evidence for select to authenticated
  using (app.is_member(organization_id));

create policy actions_select on app.finding_actions for select to authenticated
  using (app.is_member(organization_id));
create policy actions_insert on app.finding_actions for insert to authenticated
  with check (app.has_role(organization_id, array['ADMIN', 'FINANCE', 'AUDITOR']));

create policy reprocessing_select on app.reprocessing_jobs for select to authenticated
  using (app.is_member(organization_id));
create policy reprocessing_insert on app.reprocessing_jobs for insert to authenticated
  with check (app.has_role(organization_id, array['ADMIN', 'FINANCE']));
create policy reprocessing_update on app.reprocessing_jobs for update to authenticated
  using (app.has_role(organization_id, array['ADMIN', 'FINANCE']))
  with check (app.has_role(organization_id, array['ADMIN', 'FINANCE']));
