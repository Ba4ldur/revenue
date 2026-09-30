-- =============================================================================
-- Reprocessamento, CalculationRun, Expected Revenue, Findings, Evidências, Ações.
-- Invariantes financeiras duplicadas no banco (defesa em profundidade).
-- =============================================================================

create table app.reprocessing_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  reason text not null check (length(btrim(reason)) between 3 and 1000),
  trigger_entity_type text check (trigger_entity_type is null or length(trigger_entity_type) <= 80),
  trigger_entity_id uuid,
  affected_from date not null check (extract(day from affected_from) = 1),
  affected_until date not null check (extract(day from affected_until) = 1),
  affected_contract_ids uuid[] not null default '{}',
  status text not null default 'PENDING' check (status in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  idempotency_key text check (idempotency_key is null or length(idempotency_key) between 8 and 200),
  created_by uuid references app.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  result_summary jsonb,
  error_details jsonb,
  parent_job_id uuid,
  unique (organization_id, id),
  foreign key (organization_id, parent_job_id) references app.reprocessing_jobs (organization_id, id),
  check (affected_until >= affected_from),
  check (affected_until <= (affected_from + interval '36 months')),
  check (status <> 'FAILED' or error_details is not null)
);
create unique index reprocessing_jobs_idem on app.reprocessing_jobs (organization_id, idempotency_key)
  where idempotency_key is not null;
create trigger reprocessing_jobs_updated_at before update on app.reprocessing_jobs
  for each row execute function app.set_updated_at();
create trigger reprocessing_jobs_audit after insert or update on app.reprocessing_jobs
  for each row execute function app.audit_row();
create trigger reprocessing_jobs_no_delete before delete on app.reprocessing_jobs
  for each row execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- CalculationRun (ADR-006)
-- -----------------------------------------------------------------------------

create table app.calculation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  engine_name text not null,
  engine_version text not null,
  calculation_type text not null check (calculation_type in ('EXPECTED_REVENUE', 'RECONCILIATION')),
  scope_type text not null default 'CONTRACT' check (scope_type = 'CONTRACT'),
  scope_id uuid not null,
  contract_id uuid not null,
  competence date not null check (extract(day from competence) = 1),
  status text not null check (status in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SUPERSEDED')),
  input_snapshot jsonb not null check (jsonb_typeof(input_snapshot) = 'object'),
  input_snapshot_hash text not null check (input_snapshot_hash ~ '^[0-9a-f]{64}$'),
  rules_version_hash text check (rules_version_hash is null or rules_version_hash ~ '^[0-9a-f]{64}$'),
  parameters jsonb not null default '{}'::jsonb check (jsonb_typeof(parameters) = 'object'),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  triggered_by_type text not null check (triggered_by_type in ('USER', 'SYSTEM', 'REPROCESSING')),
  triggered_by_user_id uuid references app.users (id),
  parent_run_id uuid,
  supersedes_run_id uuid,
  superseded_at timestamptz,
  reprocessing_job_id uuid,
  result_summary jsonb,
  error_details jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (engine_name, engine_version) references app.engine_registry (engine_name, engine_version),
  foreign key (organization_id, contract_id) references app.contracts (organization_id, id),
  foreign key (organization_id, parent_run_id) references app.calculation_runs (organization_id, id),
  foreign key (organization_id, supersedes_run_id) references app.calculation_runs (organization_id, id),
  foreign key (organization_id, reprocessing_job_id) references app.reprocessing_jobs (organization_id, id),
  check (scope_id = contract_id),
  check (calculation_type <> 'EXPECTED_REVENUE' or engine_name = 'expected_revenue_engine'),
  check (calculation_type <> 'RECONCILIATION' or (engine_name = 'reconciliation_engine' and parent_run_id is not null)),
  check (status not in ('COMPLETED', 'SUPERSEDED') or (completed_at is not null and error_details is null and result_summary is not null)),
  check (status <> 'FAILED' or (completed_at is not null and error_details is not null)),
  check ((status = 'SUPERSEDED') = (superseded_at is not null)),
  check (triggered_by_type <> 'USER' or triggered_by_user_id is not null),
  check (triggered_by_type <> 'REPROCESSING' or reprocessing_job_id is not null)
);
-- Um único resultado corrente por (tipo, escopo, competência).
create unique index calculation_runs_one_current on app.calculation_runs
  (organization_id, calculation_type, scope_id, competence) where status = 'COMPLETED';
create index calculation_runs_scope_idx on app.calculation_runs (organization_id, contract_id, competence, created_at desc);
create index calculation_runs_hash_idx on app.calculation_runs
  (organization_id, calculation_type, scope_id, competence, engine_version, input_snapshot_hash);
create trigger calculation_runs_audit after insert or update on app.calculation_runs
  for each row execute function app.audit_row('input_snapshot');

create or replace function app.calculation_runs_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_fixed text[] := array['organization_id', 'engine_name', 'engine_version', 'calculation_type', 'scope_type',
                          'scope_id', 'contract_id', 'competence', 'input_snapshot', 'input_snapshot_hash',
                          'rules_version_hash', 'parameters', 'started_at', 'triggered_by_type',
                          'triggered_by_user_id', 'parent_run_id', 'supersedes_run_id', 'reprocessing_job_id',
                          'created_at'];
  v_col text;
begin
  if tg_op = 'DELETE' then
    raise exception 'IMMUTABLE_RECORD: CalculationRun é preservado' using errcode = 'P0001';
  end if;
  foreach v_col in array v_fixed loop
    if (to_jsonb(new) -> v_col) is distinct from (to_jsonb(old) -> v_col) then
      raise exception 'IMMUTABLE_FIELD: %.% não pode mudar', tg_table_name, v_col using errcode = 'P0001';
    end if;
  end loop;
  if old.status = 'COMPLETED' then
    if new.status <> 'SUPERSEDED'
       or new.result_summary is distinct from old.result_summary
       or new.completed_at is distinct from old.completed_at then
      raise exception 'IMMUTABLE_RECORD: run concluído só pode ser substituído' using errcode = 'P0001';
    end if;
  elsif old.status in ('FAILED', 'SUPERSEDED') then
    raise exception 'IMMUTABLE_RECORD: run % é histórico', old.status using errcode = 'P0001';
  end if;
  if new.status = 'COMPLETED' and old.status <> 'COMPLETED' and new.calculation_type = 'EXPECTED_REVENUE'
     and not exists (select 1 from app.expected_revenue_events e where e.calculation_run_id = new.id) then
    raise exception 'INVARIANT_VIOLATION: run de expected revenue sem resultado' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger calculation_runs_guard before update or delete on app.calculation_runs
  for each row execute function app.calculation_runs_guard();

-- Saídas de motor só podem ser anexadas a run em execução do tipo correto.
create or replace function app.assert_run_open(p_org uuid, p_run uuid, p_type text) returns void
language plpgsql set search_path = '' as $$
declare v record;
begin
  select calculation_type, status into v from app.calculation_runs
   where id = p_run and organization_id = p_org;
  if not found or v.calculation_type <> p_type or v.status <> 'RUNNING' then
    raise exception 'RUN_NOT_OPEN: saída de motor exige run % em RUNNING', p_type using errcode = 'P0001';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Expected Revenue
-- -----------------------------------------------------------------------------

create table app.expected_revenue_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  customer_id uuid not null,
  contract_id uuid not null,
  contract_version_id uuid not null,
  competence date not null check (extract(day from competence) = 1),
  base_amount numeric(18, 2) not null check (base_amount >= 0),
  variable_amount numeric(18, 2) not null check (variable_amount >= 0),
  adjustment_amount numeric(18, 2) not null default 0,
  discount_amount numeric(18, 2) not null check (discount_amount >= 0),
  expected_total numeric(18, 2) not null check (expected_total >= 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  calculation_run_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (calculation_run_id),
  foreign key (organization_id, contract_id, customer_id) references app.contracts (organization_id, id, customer_id),
  foreign key (organization_id, contract_version_id, contract_id)
    references app.contract_versions (organization_id, id, contract_id),
  foreign key (organization_id, calculation_run_id) references app.calculation_runs (organization_id, id),
  constraint expected_revenue_total_invariant
    check (base_amount + variable_amount + adjustment_amount - discount_amount = expected_total)
);
create index expected_revenue_events_scope_idx on app.expected_revenue_events (organization_id, contract_id, competence);
create trigger expected_revenue_events_immutable before update or delete on app.expected_revenue_events
  for each row execute function app.forbid_mutation();

create table app.expected_revenue_components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  expected_revenue_event_id uuid not null,
  component_type text not null check (component_type in ('BASE', 'EXCESS', 'ADDITIONAL_SERVICE', 'ADJUSTMENT', 'DISCOUNT', 'OTHER')),
  sort_order integer not null default 0,
  description text not null check (length(description) between 1 and 500),
  quantity numeric(18, 6),
  unit text check (unit in ('HOUR', 'UNIT', 'USER', 'TICKET', 'KM', 'ITEM', 'VISIT', 'OTHER', 'MONTH')),
  unit_price numeric(18, 6),
  amount numeric(18, 2) not null,
  source_rule_id uuid,
  source_operational_event_id uuid,
  calculation_formula text not null check (length(calculation_formula) between 1 and 1000),
  calculation_metadata jsonb not null check (jsonb_typeof(calculation_metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, expected_revenue_event_id) references app.expected_revenue_events (organization_id, id),
  foreign key (organization_id, source_rule_id) references app.contract_rules (organization_id, id),
  foreign key (organization_id, source_operational_event_id) references app.operational_events (organization_id, id),
  check (component_type <> 'DISCOUNT' or amount <= 0),
  check (component_type not in ('BASE', 'EXCESS', 'ADDITIONAL_SERVICE') or amount >= 0)
);
create index expected_revenue_components_event_idx on app.expected_revenue_components (expected_revenue_event_id);
create trigger expected_revenue_components_immutable before update or delete on app.expected_revenue_components
  for each row execute function app.forbid_mutation();

-- Proveniência estruturada de cada componente (regras e eventos usados).
create table app.expected_revenue_component_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  component_id uuid not null,
  source_type text not null check (source_type in ('CONTRACT_RULE', 'OPERATIONAL_EVENT')),
  role text not null check (role in ('FEE', 'INCLUDED_QUANTITY', 'UNIT_PRICE', 'USAGE', 'DISCOUNT')),
  rule_id uuid,
  operational_event_id uuid,
  quantity numeric(18, 6),
  created_at timestamptz not null default now(),
  foreign key (organization_id, component_id) references app.expected_revenue_components (organization_id, id),
  foreign key (organization_id, rule_id) references app.contract_rules (organization_id, id),
  foreign key (organization_id, operational_event_id) references app.operational_events (organization_id, id),
  check ((source_type = 'CONTRACT_RULE') = (rule_id is not null and operational_event_id is null)),
  check ((source_type = 'OPERATIONAL_EVENT') = (operational_event_id is not null and rule_id is null))
);
create index expected_revenue_component_sources_idx on app.expected_revenue_component_sources (component_id);
create trigger expected_revenue_component_sources_immutable before update or delete on app.expected_revenue_component_sources
  for each row execute function app.forbid_mutation();

create or replace function app.expected_revenue_events_before_insert() returns trigger
language plpgsql set search_path = '' as $$
declare v record;
begin
  perform app.assert_run_open(new.organization_id, new.calculation_run_id, 'EXPECTED_REVENUE');
  select contract_id, competence into v from app.calculation_runs where id = new.calculation_run_id;
  if v.contract_id <> new.contract_id or v.competence <> new.competence then
    raise exception 'INVARIANT_VIOLATION: expected revenue fora do escopo do run' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger expected_revenue_events_before_insert before insert on app.expected_revenue_events
  for each row execute function app.expected_revenue_events_before_insert();

create or replace function app.expected_revenue_components_before_insert() returns trigger
language plpgsql set search_path = '' as $$
declare v_run uuid;
begin
  select calculation_run_id into v_run from app.expected_revenue_events
   where id = new.expected_revenue_event_id and organization_id = new.organization_id;
  perform app.assert_run_open(new.organization_id, v_run, 'EXPECTED_REVENUE');
  return new;
end $$;
create trigger expected_revenue_components_before_insert before insert on app.expected_revenue_components
  for each row execute function app.expected_revenue_components_before_insert();

-- Invariante (FINANCIAL_INVARIANTS): verificada no COMMIT (constraint trigger diferido).
create or replace function app.check_expected_revenue_invariants() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_event_id uuid;
  e record;
  s record;
begin
  v_event_id := case when tg_table_name = 'expected_revenue_events' then new.id else new.expected_revenue_event_id end;
  select * into e from app.expected_revenue_events where id = v_event_id;
  select count(*) as n,
         coalesce(sum(amount), 0) as total,
         coalesce(sum(amount) filter (where component_type = 'BASE'), 0) as base,
         coalesce(sum(amount) filter (where component_type in ('EXCESS', 'ADDITIONAL_SERVICE')), 0) as variable,
         coalesce(sum(amount) filter (where component_type in ('ADJUSTMENT', 'OTHER')), 0) as adjustment,
         coalesce(-sum(amount) filter (where component_type = 'DISCOUNT'), 0) as discount
    into s
    from app.expected_revenue_components where expected_revenue_event_id = v_event_id;
  if s.n = 0 then
    raise exception 'INVARIANT_VIOLATION: expected revenue % sem componentes', v_event_id using errcode = 'P0001';
  end if;
  if s.total <> e.expected_total or s.base <> e.base_amount or s.variable <> e.variable_amount
     or s.adjustment <> e.adjustment_amount or s.discount <> e.discount_amount then
    raise exception 'INVARIANT_VIOLATION: componentes (total %) incompatíveis com expected_total % do evento %',
      s.total, e.expected_total, v_event_id using errcode = 'P0001';
  end if;
  return null;
end $$;
create constraint trigger expected_revenue_events_invariant
  after insert on app.expected_revenue_events deferrable initially deferred
  for each row execute function app.check_expected_revenue_invariants();
create constraint trigger expected_revenue_components_invariant
  after insert on app.expected_revenue_components deferrable initially deferred
  for each row execute function app.check_expected_revenue_invariants();

-- -----------------------------------------------------------------------------
-- Findings (DETECTION_VS_CLASSIFICATION)
-- -----------------------------------------------------------------------------

create table app.findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  customer_id uuid not null,
  contract_id uuid not null,
  contract_version_id uuid,
  competence date not null check (extract(day from competence) = 1),
  finding_type text not null check (finding_type in (
    'CONSUMO_EXCEDENTE_NAO_FATURADO', 'COBRANCA_ABAIXO_DO_CONTRATO', 'CLIENTE_ATIVO_SEM_FATURAMENTO')),
  expected_amount numeric(18, 2) not null check (expected_amount > 0),
  billed_amount numeric(18, 2) not null check (billed_amount >= 0),
  difference_amount numeric(18, 2) not null check (difference_amount > 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  severity text not null check (severity in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  status text not null default 'OPEN' check (status in (
    'OPEN', 'UNDER_REVIEW', 'CONFIRMED', 'JUSTIFIED', 'FALSE_POSITIVE', 'DISCARDED', 'RECOVERED')),
  extraction_confidence numeric(5, 4) check (extraction_confidence is null or extraction_confidence between 0 and 1),
  entity_match_confidence numeric(5, 4) check (entity_match_confidence is null or entity_match_confidence between 0 and 1),
  evidence_completeness numeric(5, 4) check (evidence_completeness is null or evidence_completeness between 0 and 1),
  explanation text not null check (length(explanation) between 1 and 4000),
  calculation_run_id uuid not null,
  expected_revenue_event_id uuid not null,
  previous_finding_id uuid,
  recovered_amount numeric(18, 2),
  detected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (organization_id, id),
  unique (calculation_run_id),
  foreign key (organization_id, contract_id, customer_id) references app.contracts (organization_id, id, customer_id),
  foreign key (organization_id, contract_version_id, contract_id)
    references app.contract_versions (organization_id, id, contract_id),
  foreign key (organization_id, calculation_run_id) references app.calculation_runs (organization_id, id),
  foreign key (organization_id, expected_revenue_event_id) references app.expected_revenue_events (organization_id, id),
  foreign key (organization_id, previous_finding_id) references app.findings (organization_id, id),
  constraint findings_difference_invariant check (difference_amount = expected_amount - billed_amount),
  check (recovered_amount is null or (recovered_amount > 0 and recovered_amount <= difference_amount)),
  check ((status = 'RECOVERED') = (recovered_amount is not null)),
  check ((status in ('JUSTIFIED', 'FALSE_POSITIVE', 'DISCARDED', 'RECOVERED')) = (resolved_at is not null))
);
create index findings_org_status_idx on app.findings (organization_id, status);
create index findings_scope_idx on app.findings (organization_id, contract_id, competence);
create index findings_detected_idx on app.findings (organization_id, detected_at desc);
create trigger findings_updated_at before update on app.findings
  for each row execute function app.set_updated_at();
create trigger findings_audit after insert or update on app.findings
  for each row execute function app.audit_row();

create or replace function app.findings_before_insert() returns trigger
language plpgsql set search_path = '' as $$
declare r record; e record;
begin
  if new.status <> 'OPEN' then
    raise exception 'INVALID_STATE: finding gerado pelo motor nasce OPEN' using errcode = 'P0001';
  end if;
  perform app.assert_run_open(new.organization_id, new.calculation_run_id, 'RECONCILIATION');
  select * into r from app.calculation_runs where id = new.calculation_run_id;
  select * into e from app.expected_revenue_events
   where id = new.expected_revenue_event_id and organization_id = new.organization_id;
  if e.calculation_run_id <> r.parent_run_id or e.contract_id <> new.contract_id
     or e.competence <> new.competence or e.customer_id <> new.customer_id
     or r.contract_id <> new.contract_id or r.competence <> new.competence then
    raise exception 'INVARIANT_VIOLATION: finding fora da cadeia run → expected revenue' using errcode = 'P0001';
  end if;
  if new.expected_amount <> e.expected_total then
    raise exception 'INVARIANT_VIOLATION: expected_amount % difere da memória de cálculo %',
      new.expected_amount, e.expected_total using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger findings_before_insert before insert on app.findings
  for each row execute function app.findings_before_insert();

-- Status só muda através de FindingAction; valores nunca mudam.
create or replace function app.findings_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'IMMUTABLE_RECORD: finding é preservado' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - 'status' - 'resolved_at' - 'recovered_amount' - 'updated_at')
     <> (to_jsonb(old) - 'status' - 'resolved_at' - 'recovered_amount' - 'updated_at') then
    raise exception 'IMMUTABLE_FIELD: dados do finding são imutáveis' using errcode = 'P0001';
  end if;
  if coalesce(current_setting('app.finding_action_ctx', true), '') <> old.id::text then
    raise exception 'FORBIDDEN: status do finding só muda via FindingAction' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger findings_guard before update or delete on app.findings
  for each row execute function app.findings_guard();

create table app.finding_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  finding_id uuid not null,
  sort_order integer not null default 0,
  evidence_type text not null check (evidence_type in (
    'CONTRACT_DOCUMENT', 'CONTRACT_CLAUSE', 'CONTRACT_RULE', 'OPERATIONAL_EVENT', 'IMPORT_ROW',
    'EXPECTED_REVENUE', 'CALCULATION_COMPONENT', 'BILLING_EVENT', 'NO_BILLING_FOUND', 'CALCULATION_RUN')),
  entity_type text not null check (length(entity_type) between 1 and 80),
  entity_id uuid,
  description text not null check (length(description) between 1 and 2000),
  source_document_id uuid,
  source_import_id uuid,
  source_import_row_id uuid,
  source_rule_id uuid,
  source_operational_event_id uuid,
  source_billing_event_id uuid,
  source_component_id uuid,
  source_calculation_run_id uuid,
  page_number integer check (page_number is null or page_number >= 1),
  text_excerpt text check (text_excerpt is null or length(text_excerpt) <= 4000),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, finding_id) references app.findings (organization_id, id),
  foreign key (organization_id, source_document_id) references app.contract_documents (organization_id, id),
  foreign key (organization_id, source_import_id) references app.imports (organization_id, id),
  foreign key (organization_id, source_import_row_id) references app.import_rows (organization_id, id),
  foreign key (organization_id, source_rule_id) references app.contract_rules (organization_id, id),
  foreign key (organization_id, source_operational_event_id) references app.operational_events (organization_id, id),
  foreign key (organization_id, source_billing_event_id) references app.billing_events (organization_id, id),
  foreign key (organization_id, source_component_id) references app.expected_revenue_components (organization_id, id),
  foreign key (organization_id, source_calculation_run_id) references app.calculation_runs (organization_id, id)
);
create index finding_evidence_finding_idx on app.finding_evidence (finding_id, sort_order);
create trigger finding_evidence_immutable before update or delete on app.finding_evidence
  for each row execute function app.forbid_mutation();

create or replace function app.finding_evidence_before_insert() returns trigger
language plpgsql set search_path = '' as $$
declare v_run uuid;
begin
  select calculation_run_id into v_run from app.findings
   where id = new.finding_id and organization_id = new.organization_id;
  perform app.assert_run_open(new.organization_id, v_run, 'RECONCILIATION');
  return new;
end $$;
create trigger finding_evidence_before_insert before insert on app.finding_evidence
  for each row execute function app.finding_evidence_before_insert();

-- -----------------------------------------------------------------------------
-- FindingAction: única via de classificação humana
-- -----------------------------------------------------------------------------

create table app.finding_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  finding_id uuid not null,
  action_type text not null check (action_type in (
    'START_REVIEW', 'CONFIRM', 'JUSTIFY', 'MARK_FALSE_POSITIVE', 'DISCARD', 'MARK_RECOVERED', 'REOPEN', 'NOTE')),
  previous_status text not null,
  new_status text not null,
  reason text check (reason is null or length(btrim(reason)) between 3 and 2000),
  notes text check (notes is null or length(notes) <= 4000),
  recovered_amount numeric(18, 2) check (recovered_amount is null or recovered_amount > 0),
  performed_by uuid not null references app.users (id),
  performed_at timestamptz not null default now(),
  -- anexos fora do MVP: coluna reservada, obrigatoriamente nula
  attachment_id uuid check (attachment_id is null),
  unique (organization_id, id),
  foreign key (organization_id, finding_id) references app.findings (organization_id, id)
);
create index finding_actions_finding_idx on app.finding_actions (finding_id, performed_at);
create trigger finding_actions_immutable before update or delete on app.finding_actions
  for each row execute function app.forbid_mutation();

create or replace function app.finding_actions_apply() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  f record;
  v_user uuid := app.current_user_id();
  v_run_status text;
  v_new text;
begin
  if v_user is null then
    raise exception 'UNAUTHENTICATED: ação de finding exige usuário' using errcode = '42501';
  end if;
  new.performed_by := v_user;
  new.performed_at := now();

  select * into f from app.findings
   where id = new.finding_id and organization_id = new.organization_id
   for update;
  if not found then
    raise exception 'NOT_FOUND: finding' using errcode = 'P0002';
  end if;

  if new.action_type in ('START_REVIEW', 'NOTE') then
    if not app.has_role(f.organization_id, array['ADMIN', 'FINANCE', 'AUDITOR']) then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
  elsif not app.has_role(f.organization_id, array['ADMIN', 'FINANCE']) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select status into v_run_status from app.calculation_runs where id = f.calculation_run_id;
  if new.action_type <> 'NOTE' and v_run_status <> 'COMPLETED' then
    raise exception 'FINDING_NOT_CURRENT: finding de execução substituída não pode ser classificado'
      using errcode = 'P0001';
  end if;

  v_new := case
    when new.action_type = 'START_REVIEW' and f.status = 'OPEN' then 'UNDER_REVIEW'
    when new.action_type = 'CONFIRM' and f.status in ('OPEN', 'UNDER_REVIEW') then 'CONFIRMED'
    when new.action_type = 'JUSTIFY' and f.status in ('OPEN', 'UNDER_REVIEW') then 'JUSTIFIED'
    when new.action_type = 'MARK_FALSE_POSITIVE' and f.status in ('OPEN', 'UNDER_REVIEW') then 'FALSE_POSITIVE'
    when new.action_type = 'DISCARD' and f.status in ('OPEN', 'UNDER_REVIEW') then 'DISCARDED'
    when new.action_type = 'MARK_RECOVERED' and f.status = 'CONFIRMED' then 'RECOVERED'
    when new.action_type = 'REOPEN' and f.status in ('CONFIRMED', 'JUSTIFIED', 'FALSE_POSITIVE', 'DISCARDED') then 'UNDER_REVIEW'
    when new.action_type = 'NOTE' then f.status
    else null
  end;
  if v_new is null then
    raise exception 'INVALID_TRANSITION: % não é permitido com status %', new.action_type, f.status
      using errcode = 'P0001';
  end if;
  if new.action_type in ('JUSTIFY', 'MARK_FALSE_POSITIVE', 'DISCARD', 'REOPEN') and new.reason is null then
    raise exception 'REASON_REQUIRED: % exige motivo', new.action_type using errcode = 'P0001';
  end if;
  if new.action_type = 'NOTE' and new.notes is null then
    raise exception 'NOTES_REQUIRED' using errcode = 'P0001';
  end if;
  if new.action_type = 'MARK_RECOVERED' then
    if new.recovered_amount is null or new.recovered_amount > f.difference_amount then
      raise exception 'INVALID_AMOUNT: valor recuperado deve estar entre 0,01 e a diferença' using errcode = 'P0001';
    end if;
  elsif new.recovered_amount is not null then
    raise exception 'INVALID_AMOUNT: valor recuperado só em MARK_RECOVERED' using errcode = 'P0001';
  end if;

  new.previous_status := f.status;
  new.new_status := v_new;

  if v_new <> f.status then
    perform set_config('app.finding_action_ctx', f.id::text, true);
    update app.findings
       set status = v_new,
           resolved_at = case when v_new in ('JUSTIFIED', 'FALSE_POSITIVE', 'DISCARDED', 'RECOVERED') then now() else null end,
           recovered_amount = case when v_new = 'RECOVERED' then new.recovered_amount else null end
     where id = f.id;
    perform set_config('app.finding_action_ctx', '', true);
  end if;
  return new;
end $$;
create trigger finding_actions_apply before insert on app.finding_actions
  for each row execute function app.finding_actions_apply();
create trigger finding_actions_audit after insert on app.finding_actions
  for each row execute function app.audit_row();
