-- =============================================================================
-- Imports, linhas, resolução de entidades, eventos operacionais e de faturamento.
-- =============================================================================

create table app.imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  type text not null check (type in ('OPERATIONAL', 'BILLING', 'CONTRACT_SUPPORT')),
  file_name text not null check (length(file_name) between 1 and 255),
  file_format text not null check (file_format in ('CSV', 'XLSX')),
  storage_bucket text not null default 'imports' check (storage_bucket = 'imports'),
  storage_path text not null check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(csv|xlsx)$'),
  mime_type text not null check (length(mime_type) between 3 and 120),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  sha256_hash text not null check (sha256_hash ~ '^[0-9a-f]{64}$'),
  source_system text check (source_system is null or length(source_system) <= 100),
  headers jsonb check (headers is null or jsonb_typeof(headers) = 'array'),
  -- configuração escolhida pelo usuário (payload de importação — JSONB justificado)
  mapping jsonb check (mapping is null or jsonb_typeof(mapping) = 'object'),
  mapping_version integer not null default 0 check (mapping_version >= 0),
  parse_options jsonb not null default '{}'::jsonb check (jsonb_typeof(parse_options) = 'object'),
  normalization_engine_name text not null default 'import_normalization_engine'
    check (normalization_engine_name = 'import_normalization_engine'),
  normalization_engine_version text,
  status text not null default 'UPLOADED' check (status in (
    'UPLOADED', 'MAPPING_REQUIRED', 'VALIDATING', 'PROCESSING', 'NEEDS_REVIEW',
    'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'DUPLICATE')),
  row_count integer not null default 0 check (row_count >= 0),
  valid_rows integer not null default 0 check (valid_rows >= 0),
  invalid_rows integer not null default 0 check (invalid_rows >= 0),
  duplicate_rows integer not null default 0 check (duplicate_rows >= 0),
  pending_match_rows integer not null default 0 check (pending_match_rows >= 0),
  imported_rows integer not null default 0 check (imported_rows >= 0),
  duplicate_of_import_id uuid,
  uploaded_by uuid not null references app.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  error_summary jsonb,
  unique (organization_id, id),
  foreign key (organization_id, duplicate_of_import_id) references app.imports (organization_id, id),
  foreign key (normalization_engine_name, normalization_engine_version)
    references app.engine_registry (engine_name, engine_version),
  check (split_part(storage_path, '/', 1) = organization_id::text),
  check ((status = 'DUPLICATE') = (duplicate_of_import_id is not null))
);
-- Mesmo arquivo (hash) não é reprocessado: nova tentativa vira DUPLICATE (ADR-008).
create unique index imports_hash_uq on app.imports (organization_id, type, sha256_hash)
  where status not in ('DUPLICATE', 'FAILED');
create index imports_org_created_idx on app.imports (organization_id, created_at desc);
create trigger imports_updated_at before update on app.imports
  for each row execute function app.set_updated_at();
create trigger imports_audit after insert or update on app.imports
  for each row execute function app.audit_row('headers');
create trigger imports_no_delete before delete on app.imports
  for each row execute function app.forbid_mutation();

create or replace function app.imports_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.sha256_hash <> old.sha256_hash or new.storage_path <> old.storage_path
     or new.type <> old.type or new.organization_id <> old.organization_id then
    raise exception 'IMMUTABLE_FIELD: identidade do import é imutável' using errcode = 'P0001';
  end if;
  if old.status in ('COMPLETED', 'COMPLETED_WITH_ERRORS', 'DUPLICATE', 'FAILED')
     and new.status <> old.status then
    raise exception 'INVALID_TRANSITION: import finalizado (%)', old.status using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger imports_guard before update on app.imports
  for each row execute function app.imports_guard();

-- -----------------------------------------------------------------------------
-- Resolução de entidades (ADR: ENTITY_RESOLUTION)
-- -----------------------------------------------------------------------------

create table app.entity_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  entity_type text not null default 'CUSTOMER' check (entity_type = 'CUSTOMER'),
  -- chave normalizada da origem: cnpj:<cnpj> | ext:<id> | name:<nome normalizado>
  source_key text not null check (source_key ~ '^(cnpj|ext|name):.+$' and length(source_key) <= 310),
  source_label text check (source_label is null or length(source_label) <= 300),
  candidate_customer_id uuid,
  status text not null check (status in ('MATCHED', 'PROPOSED', 'UNMATCHED', 'REJECTED')),
  method text not null check (method in (
    'CNPJ_EXACT', 'EXTERNAL_ID_EXACT', 'PREVIOUS_MATCH', 'LEGAL_NAME_EXACT',
    'TRADE_NAME_EXACT', 'FUZZY', 'MANUAL', 'NONE')),
  entity_match_confidence numeric(5, 4) check (entity_match_confidence is null or entity_match_confidence between 0 and 1),
  engine_name text not null default 'entity_resolution_engine' check (engine_name = 'entity_resolution_engine'),
  engine_version text not null,
  decided_by uuid references app.users (id),
  decided_at timestamptz,
  decision_reason text check (decision_reason is null or length(decision_reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, candidate_customer_id) references app.customers (organization_id, id),
  foreign key (engine_name, engine_version) references app.engine_registry (engine_name, engine_version),
  check (status not in ('MATCHED', 'PROPOSED') or candidate_customer_id is not null),
  check (status <> 'UNMATCHED' or candidate_customer_id is null),
  -- só CNPJ exato e external_id exato podem ser decididos sem humano
  check (status <> 'MATCHED' or method in ('CNPJ_EXACT', 'EXTERNAL_ID_EXACT') or decided_by is not null),
  check (status <> 'REJECTED' or decided_by is not null),
  check (method <> 'FUZZY' or status <> 'MATCHED' or decided_by is not null)
);
create unique index entity_matches_one_matched on app.entity_matches (organization_id, entity_type, source_key)
  where status = 'MATCHED';
create unique index entity_matches_candidate_uq on app.entity_matches
  (organization_id, entity_type, source_key, candidate_customer_id) nulls not distinct;
create trigger entity_matches_updated_at before update on app.entity_matches
  for each row execute function app.set_updated_at();
create trigger entity_matches_audit after insert or update on app.entity_matches
  for each row execute function app.audit_row();
create trigger entity_matches_no_delete before delete on app.entity_matches
  for each row execute function app.forbid_mutation();

create or replace function app.entity_matches_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.source_key <> old.source_key or new.organization_id <> old.organization_id then
    raise exception 'IMMUTABLE_FIELD: chave de origem é imutável' using errcode = 'P0001';
  end if;
  if new.status <> old.status and not (
    (old.status = 'PROPOSED' and new.status in ('MATCHED', 'REJECTED')) or
    (old.status = 'UNMATCHED' and new.status = 'MATCHED') or
    (old.status = 'MATCHED' and new.status = 'REJECTED')
  ) then
    raise exception 'INVALID_TRANSITION: % -> %', old.status, new.status using errcode = 'P0001';
  end if;
  if old.status in ('MATCHED', 'REJECTED', 'PROPOSED')
     and new.candidate_customer_id is distinct from old.candidate_customer_id then
    raise exception 'IMMUTABLE_FIELD: candidato não muda; registre nova decisão' using errcode = 'P0001';
  end if;
  if old.status = 'REJECTED' then
    raise exception 'IMMUTABLE_RECORD: decisão rejeitada é histórica' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger entity_matches_guard before update on app.entity_matches
  for each row execute function app.entity_matches_guard();

-- -----------------------------------------------------------------------------
-- Linhas de import
-- -----------------------------------------------------------------------------

create table app.import_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  import_id uuid not null,
  row_number integer not null check (row_number >= 1),
  raw_data jsonb not null check (jsonb_typeof(raw_data) = 'object' and pg_column_size(raw_data) <= 16384),
  normalized_data jsonb check (normalized_data is null or jsonb_typeof(normalized_data) = 'object'),
  row_hash text not null check (row_hash ~ '^[0-9a-f]{64}$'),
  dedup_key text check (dedup_key is null or length(dedup_key) between 5 and 400),
  customer_source_key text,
  entity_match_id uuid,
  status text not null default 'PENDING' check (status in (
    'PENDING', 'VALID', 'INVALID', 'PENDING_MATCH', 'IMPORTED', 'DUPLICATE', 'CONFLICT')),
  error_message text check (error_message is null or length(error_message) <= 2000),
  errors jsonb check (errors is null or jsonb_typeof(errors) = 'array'),
  target_entity_type text check (target_entity_type in ('OPERATIONAL_EVENT', 'BILLING_EVENT')),
  target_entity_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (import_id, row_number),
  foreign key (organization_id, import_id) references app.imports (organization_id, id),
  foreign key (organization_id, entity_match_id) references app.entity_matches (organization_id, id),
  check (status not in ('IMPORTED', 'DUPLICATE') or (target_entity_type is not null and target_entity_id is not null)),
  check (status not in ('INVALID', 'CONFLICT') or error_message is not null)
);
create index import_rows_status_idx on app.import_rows (import_id, status);
create index import_rows_match_key_idx on app.import_rows (organization_id, customer_source_key)
  where status = 'PENDING_MATCH';
create trigger import_rows_updated_at before update on app.import_rows
  for each row execute function app.set_updated_at();
create trigger import_rows_no_delete before delete on app.import_rows
  for each row execute function app.forbid_mutation();

create or replace function app.import_rows_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.raw_data <> old.raw_data or new.row_hash <> old.row_hash or new.row_number <> old.row_number
     or new.import_id <> old.import_id then
    raise exception 'IMMUTABLE_FIELD: conteúdo bruto da linha é imutável' using errcode = 'P0001';
  end if;
  if old.status in ('IMPORTED', 'DUPLICATE') then
    raise exception 'IMMUTABLE_RECORD: linha já materializada' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger import_rows_guard before update on app.import_rows
  for each row execute function app.import_rows_guard();

-- -----------------------------------------------------------------------------
-- Eventos operacionais (FATO — ADR-017)
-- -----------------------------------------------------------------------------

create table app.operational_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  customer_id uuid not null,
  contract_id uuid,
  competence date not null check (extract(day from competence) = 1),
  event_date date,
  event_type text not null check (length(btrim(event_type)) between 1 and 100),
  quantity numeric(18, 6) not null check (quantity >= 0),
  unit text not null check (unit in ('HOUR', 'UNIT', 'USER', 'TICKET', 'KM', 'ITEM', 'VISIT', 'OTHER')),
  external_id text check (external_id is null or length(external_id) between 1 and 200),
  description text check (description is null or length(description) <= 1000),
  dedup_key text not null check (length(dedup_key) between 5 and 400),
  source_type text not null check (source_type in ('OPERATIONAL_IMPORT', 'MANUAL_ENTRY')),
  source_import_id uuid,
  source_import_row_id uuid,
  entity_match_id uuid,
  entity_match_confidence numeric(5, 4) check (entity_match_confidence is null or entity_match_confidence between 0 and 1),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'VOIDED')),
  voided_at timestamptz,
  voided_by uuid references app.users (id),
  void_reason text check (void_reason is null or length(btrim(void_reason)) between 3 and 1000),
  replaced_by_event_id uuid,
  created_by uuid references app.users (id),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, customer_id) references app.customers (organization_id, id),
  foreign key (organization_id, contract_id, customer_id) references app.contracts (organization_id, id, customer_id),
  foreign key (organization_id, source_import_id) references app.imports (organization_id, id),
  foreign key (organization_id, source_import_row_id) references app.import_rows (organization_id, id),
  foreign key (organization_id, entity_match_id) references app.entity_matches (organization_id, id),
  foreign key (organization_id, replaced_by_event_id) references app.operational_events (organization_id, id),
  check (source_type <> 'OPERATIONAL_IMPORT' or (source_import_id is not null and source_import_row_id is not null)),
  check ((status = 'VOIDED') = (voided_at is not null and void_reason is not null))
);
create unique index operational_events_dedup_uq on app.operational_events (organization_id, dedup_key)
  where status = 'ACTIVE';
create index operational_events_scope_idx on app.operational_events (organization_id, customer_id, competence)
  where status = 'ACTIVE';

-- Eventos são fatos: só é permitida a anulação (ACTIVE -> VOIDED).
create or replace function app.events_void_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'IMMUTABLE_RECORD: eventos não são apagados; use anulação' using errcode = 'P0001';
  end if;
  if old.status <> 'ACTIVE' or new.status <> 'VOIDED'
     or (to_jsonb(new) - 'status' - 'voided_at' - 'voided_by' - 'void_reason' - 'replaced_by_event_id')
        <> (to_jsonb(old) - 'status' - 'voided_at' - 'voided_by' - 'void_reason' - 'replaced_by_event_id') then
    raise exception 'IMMUTABLE_RECORD: evento só pode ser anulado' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger operational_events_guard before update or delete on app.operational_events
  for each row execute function app.events_void_only();
create trigger operational_events_audit after update on app.operational_events
  for each row execute function app.audit_row();

-- -----------------------------------------------------------------------------
-- Notas fiscais (agregador) e eventos de faturamento (FATO FATURADO)
-- -----------------------------------------------------------------------------

create table app.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  customer_id uuid not null,
  document_number text not null check (length(btrim(document_number)) between 1 and 60),
  series text not null default '' check (length(series) <= 20),
  issue_date date,
  source_import_id uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, id, customer_id),
  unique (organization_id, series, document_number),
  foreign key (organization_id, customer_id) references app.customers (organization_id, id),
  foreign key (organization_id, source_import_id) references app.imports (organization_id, id)
);
create trigger invoices_immutable before update or delete on app.invoices
  for each row execute function app.forbid_mutation();

create table app.billing_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  customer_id uuid not null,
  contract_id uuid,
  competence date not null check (extract(day from competence) = 1),
  billing_date date not null,
  document_number text check (document_number is null or length(btrim(document_number)) between 1 and 60),
  invoice_id uuid,
  description text check (description is null or length(description) <= 1000),
  amount numeric(18, 2) not null check (amount > 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  external_id text check (external_id is null or length(external_id) between 1 and 200),
  dedup_key text not null check (length(dedup_key) between 5 and 400),
  source_type text not null check (source_type in ('BILLING_IMPORT', 'MANUAL_ENTRY')),
  source_import_id uuid,
  source_import_row_id uuid,
  entity_match_id uuid,
  entity_match_confidence numeric(5, 4) check (entity_match_confidence is null or entity_match_confidence between 0 and 1),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'VOIDED')),
  voided_at timestamptz,
  voided_by uuid references app.users (id),
  void_reason text check (void_reason is null or length(btrim(void_reason)) between 3 and 1000),
  replaced_by_event_id uuid,
  created_by uuid references app.users (id),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, customer_id) references app.customers (organization_id, id),
  foreign key (organization_id, contract_id, customer_id) references app.contracts (organization_id, id, customer_id),
  foreign key (organization_id, invoice_id, customer_id) references app.invoices (organization_id, id, customer_id),
  foreign key (organization_id, source_import_id) references app.imports (organization_id, id),
  foreign key (organization_id, source_import_row_id) references app.import_rows (organization_id, id),
  foreign key (organization_id, entity_match_id) references app.entity_matches (organization_id, id),
  foreign key (organization_id, replaced_by_event_id) references app.billing_events (organization_id, id),
  check (source_type <> 'BILLING_IMPORT' or (source_import_id is not null and source_import_row_id is not null)),
  check ((status = 'VOIDED') = (voided_at is not null and void_reason is not null))
);
create unique index billing_events_dedup_uq on app.billing_events (organization_id, dedup_key)
  where status = 'ACTIVE';
create index billing_events_scope_idx on app.billing_events (organization_id, customer_id, competence)
  where status = 'ACTIVE';
create trigger billing_events_guard before update or delete on app.billing_events
  for each row execute function app.events_void_only();
create trigger billing_events_audit after update on app.billing_events
  for each row execute function app.audit_row();
