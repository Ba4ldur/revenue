-- =============================================================================
-- Clientes, contratos, versões, documentos, páginas, extrações e regras.
-- =============================================================================

create table app.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  legal_name text not null check (length(btrim(legal_name)) between 1 and 300),
  trade_name text check (trade_name is null or length(btrim(trade_name)) between 1 and 300),
  -- normalizados pela aplicação (minúsculas, sem acento, sem sufixo societário)
  legal_name_normalized text not null check (length(legal_name_normalized) between 1 and 300),
  trade_name_normalized text,
  cnpj text check (cnpj is null or app.is_valid_cnpj(cnpj)),
  external_id text check (external_id is null or length(btrim(external_id)) between 1 and 200),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 4096),
  created_by uuid references app.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (organization_id, id)
);
create unique index customers_cnpj_uq on app.customers (organization_id, cnpj)
  where cnpj is not null and deleted_at is null;
create unique index customers_external_id_uq on app.customers (organization_id, external_id)
  where external_id is not null and deleted_at is null;
create index customers_name_idx on app.customers (organization_id, legal_name_normalized);
create trigger customers_updated_at before update on app.customers
  for each row execute function app.set_updated_at();
create trigger customers_audit after insert or update on app.customers
  for each row execute function app.audit_row();
create trigger customers_no_delete before delete on app.customers
  for each row execute function app.forbid_mutation();

create table app.contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  customer_id uuid not null,
  contract_number text not null check (length(btrim(contract_number)) between 1 and 100),
  title text not null check (length(btrim(title)) between 1 and 300),
  status text not null default 'ACTIVE' check (status in ('DRAFT', 'ACTIVE', 'SUSPENDED', 'TERMINATED')),
  start_date date not null,
  end_date date check (end_date is null or end_date >= start_date),
  renewal_type text check (renewal_type in ('NONE', 'AUTOMATIC', 'MANUAL')),
  created_by uuid references app.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (organization_id, id),
  unique (organization_id, id, customer_id),
  foreign key (organization_id, customer_id) references app.customers (organization_id, id)
);
create unique index contracts_number_uq on app.contracts (organization_id, contract_number) where deleted_at is null;
create index contracts_customer_idx on app.contracts (organization_id, customer_id);
create trigger contracts_updated_at before update on app.contracts
  for each row execute function app.set_updated_at();
create trigger contracts_audit after insert or update on app.contracts
  for each row execute function app.audit_row();
create trigger contracts_no_delete before delete on app.contracts
  for each row execute function app.forbid_mutation();

create or replace function app.contracts_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.customer_id <> old.customer_id or new.organization_id <> old.organization_id then
    raise exception 'IMMUTABLE_FIELD: contrato não pode trocar de cliente/organização' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger contracts_guard before update on app.contracts
  for each row execute function app.contracts_guard();

-- -----------------------------------------------------------------------------
-- Versões (ADR-005)
-- -----------------------------------------------------------------------------

create table app.contract_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  contract_id uuid not null,
  version_number integer not null check (version_number > 0),
  valid_from date not null,
  valid_until date check (valid_until is null or valid_until >= valid_from),
  source_type text not null check (source_type in ('ORIGINAL', 'AMENDMENT', 'CORRECTION')),
  status text not null default 'ACTIVE' check (status in ('DRAFT', 'ACTIVE', 'SUPERSEDED')),
  notes text check (notes is null or length(notes) <= 2000),
  created_by uuid references app.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  superseded_at timestamptz,
  superseded_by_version_id uuid,
  unique (organization_id, id),
  unique (organization_id, id, contract_id),
  unique (contract_id, version_number),
  foreign key (organization_id, contract_id) references app.contracts (organization_id, id),
  foreign key (organization_id, superseded_by_version_id) references app.contract_versions (organization_id, id),
  check ((status = 'SUPERSEDED') = (superseded_at is not null)),
  constraint contract_versions_no_overlap exclude using gist (
    contract_id with =,
    daterange(valid_from, valid_until, '[]') with &&
  ) where (status = 'ACTIVE')
);
create trigger contract_versions_updated_at before update on app.contract_versions
  for each row execute function app.set_updated_at();
create trigger contract_versions_audit after insert or update on app.contract_versions
  for each row execute function app.audit_row();

create or replace function app.contract_versions_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_contract record;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'DRAFT' then
      raise exception 'IMMUTABLE_RECORD: versão contratual não pode ser apagada' using errcode = 'P0001';
    end if;
    return old;
  end if;

  select start_date, end_date into v_contract from app.contracts
   where id = new.contract_id and organization_id = new.organization_id;
  if tg_op = 'INSERT' and (new.valid_from < v_contract.start_date
     or (v_contract.end_date is not null and new.valid_from > v_contract.end_date)) then
    raise exception 'VERSION_OUTSIDE_CONTRACT: vigência da versão fora da vigência do contrato' using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' then
    if new.contract_id <> old.contract_id or new.version_number <> old.version_number
       or new.organization_id <> old.organization_id then
      raise exception 'IMMUTABLE_FIELD: identidade da versão é imutável' using errcode = 'P0001';
    end if;
    if old.status = 'SUPERSEDED' then
      raise exception 'IMMUTABLE_RECORD: versão substituída é histórica' using errcode = 'P0001';
    end if;
    if old.status = 'ACTIVE' then
      if new.valid_from <> old.valid_from or new.source_type <> old.source_type
         or new.status not in ('ACTIVE', 'SUPERSEDED') then
        raise exception 'IMMUTABLE_FIELD: versão ativa só pode ter vigência encerrada ou ser substituída'
          using errcode = 'P0001';
      end if;
      if new.valid_until is distinct from old.valid_until and old.valid_until is not null then
        raise exception 'IMMUTABLE_FIELD: vigência já encerrada não pode ser alterada' using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger contract_versions_guard before insert or update or delete on app.contract_versions
  for each row execute function app.contract_versions_guard();

-- -----------------------------------------------------------------------------
-- Documentos (arquivos privados — ADR-023) e texto por página
-- -----------------------------------------------------------------------------

create table app.contract_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  contract_id uuid not null,
  contract_version_id uuid,
  storage_bucket text not null default 'contract-documents' check (storage_bucket = 'contract-documents'),
  -- {organization_id}/{uuid}.pdf — nunca contém nome fornecido pelo usuário
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$'),
  file_name text not null check (length(file_name) between 1 and 255),
  mime_type text not null check (mime_type = 'application/pdf'),
  file_size bigint not null check (file_size > 0 and file_size <= 20971520),
  sha256_hash text not null check (sha256_hash ~ '^[0-9a-f]{64}$'),
  document_type text not null check (document_type in ('CONTRACT', 'AMENDMENT', 'PROPOSAL', 'PRICE_TABLE', 'SLA', 'OTHER')),
  page_count integer check (page_count is null or page_count >= 0),
  text_status text not null default 'PENDING' check (text_status in ('PENDING', 'COMPLETED', 'FAILED', 'NO_TEXT')),
  text_error text,
  uploaded_by uuid not null references app.users (id),
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, contract_id) references app.contracts (organization_id, id),
  foreign key (organization_id, contract_version_id, contract_id)
    references app.contract_versions (organization_id, id, contract_id),
  check (split_part(storage_path, '/', 1) = organization_id::text)
);
create unique index contract_documents_hash_uq on app.contract_documents (organization_id, contract_id, sha256_hash)
  where deleted_at is null;
create trigger contract_documents_updated_at before update on app.contract_documents
  for each row execute function app.set_updated_at();
create trigger contract_documents_audit after insert or update on app.contract_documents
  for each row execute function app.audit_row();
create trigger contract_documents_no_delete before delete on app.contract_documents
  for each row execute function app.forbid_mutation();

create or replace function app.contract_documents_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.storage_path <> old.storage_path or new.sha256_hash <> old.sha256_hash
     or new.contract_id <> old.contract_id or new.file_size <> old.file_size
     or new.organization_id <> old.organization_id then
    raise exception 'IMMUTABLE_FIELD: identidade do arquivo é imutável' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger contract_documents_guard before update on app.contract_documents
  for each row execute function app.contract_documents_guard();

create table app.contract_document_pages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  document_id uuid not null,
  page_number integer not null check (page_number >= 1),
  text text not null,
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (document_id, page_number),
  foreign key (organization_id, document_id) references app.contract_documents (organization_id, id)
);
create trigger contract_document_pages_immutable before update or delete on app.contract_document_pages
  for each row execute function app.forbid_mutation();

-- Normalização usada na verificação literal de trechos (ADR-013).
create or replace function app.normalize_excerpt(p text) returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(lower(coalesce(p, '')), '\s+', ' ', 'g'))
$$;

-- -----------------------------------------------------------------------------
-- Execuções de extração por IA (job rastreável e idempotente)
-- -----------------------------------------------------------------------------

create table app.rule_extraction_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  document_id uuid not null,
  provider text not null check (length(provider) between 1 and 50),
  model text not null check (length(model) between 1 and 100),
  prompt_name text not null,
  prompt_version text not null,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  idempotency_key text not null check (length(idempotency_key) between 16 and 200),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  output jsonb,
  proposals_count integer check (proposals_count is null or proposals_count >= 0),
  error_details jsonb,
  triggered_by uuid references app.users (id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, document_id) references app.contract_documents (organization_id, id),
  foreign key (prompt_name, prompt_version) references app.engine_registry (engine_name, engine_version),
  check (status <> 'COMPLETED' or (completed_at is not null and output is not null)),
  check (status <> 'FAILED' or error_details is not null)
);
create unique index rule_extraction_runs_idem on app.rule_extraction_runs (organization_id, idempotency_key)
  where status in ('PENDING', 'RUNNING', 'COMPLETED');
create trigger rule_extraction_runs_updated_at before update on app.rule_extraction_runs
  for each row execute function app.set_updated_at();
create trigger rule_extraction_runs_audit after insert or update on app.rule_extraction_runs
  for each row execute function app.audit_row('output');
create trigger rule_extraction_runs_no_delete before delete on app.rule_extraction_runs
  for each row execute function app.forbid_mutation();

create or replace function app.rule_extraction_runs_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status in ('COMPLETED', 'FAILED', 'CANCELLED') then
    raise exception 'IMMUTABLE_RECORD: extração finalizada é imutável' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger rule_extraction_runs_guard before update on app.rule_extraction_runs
  for each row execute function app.rule_extraction_runs_guard();

-- -----------------------------------------------------------------------------
-- Regras contratuais (ADR-009)
-- -----------------------------------------------------------------------------

create table app.contract_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  contract_id uuid not null,
  contract_version_id uuid not null,
  rule_type text not null check (rule_type in (
    'FIXED_MONTHLY_FEE', 'INCLUDED_QUANTITY', 'EXCESS_UNIT_PRICE', 'DISCOUNT_FIXED',
    'DISCOUNT_PERCENTAGE', 'PRICE_ADJUSTMENT', 'ADDITIONAL_SERVICE_PRICE', 'UNIT_PRICE',
    'BILLING_PERIODICITY', 'PAYMENT_DUE_DAY', 'ADJUSTMENT_INDEX', 'ADJUSTMENT_PERIODICITY', 'OTHER'
  )),
  status text not null default 'PROPOSED'
    check (status in ('PROPOSED', 'CONFIRMED', 'ACTIVE', 'SUPERSEDED', 'REJECTED')),
  currency text not null default 'BRL' check (currency = 'BRL'),
  numeric_value numeric(18, 6),
  text_value text check (text_value is null or length(text_value) <= 2000),
  unit text check (unit in ('HOUR', 'UNIT', 'USER', 'TICKET', 'KM', 'ITEM', 'VISIT', 'OTHER')),
  valid_from date not null,
  valid_until date check (valid_until is null or valid_until >= valid_from),
  source_type text not null check (source_type in ('AI_EXTRACTION', 'MANUAL_ENTRY')),
  source_document_id uuid not null,
  source_page integer check (source_page is null or source_page >= 1),
  source_text text not null check (length(btrim(source_text)) between 3 and 4000),
  -- calculado pelo banco (trigger), nunca aceito do cliente
  source_verified boolean not null default false,
  extraction_run_id uuid,
  extraction_confidence numeric(5, 4) check (extraction_confidence is null or extraction_confidence between 0 and 1),
  extracted_payload jsonb,
  created_by uuid references app.users (id),
  confirmed_by uuid references app.users (id),
  confirmed_at timestamptz,
  activated_by uuid references app.users (id),
  activated_at timestamptz,
  rejected_by uuid references app.users (id),
  rejected_at timestamptz,
  rejection_reason text check (rejection_reason is null or length(btrim(rejection_reason)) between 3 and 2000),
  superseded_at timestamptz,
  superseded_by_rule_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, contract_version_id, contract_id)
    references app.contract_versions (organization_id, id, contract_id),
  foreign key (organization_id, source_document_id) references app.contract_documents (organization_id, id),
  foreign key (organization_id, extraction_run_id) references app.rule_extraction_runs (organization_id, id),
  foreign key (organization_id, superseded_by_rule_id) references app.contract_rules (organization_id, id),
  check (source_type <> 'AI_EXTRACTION' or extraction_run_id is not null),
  -- valores monetários consolidados: >= 0 e no máximo 2 casas
  check (rule_type not in ('FIXED_MONTHLY_FEE', 'DISCOUNT_FIXED')
         or (numeric_value is not null and numeric_value >= 0 and numeric_value = round(numeric_value, 2) and unit is null)),
  check (rule_type not in ('INCLUDED_QUANTITY', 'EXCESS_UNIT_PRICE', 'UNIT_PRICE')
         or (numeric_value is not null and numeric_value >= 0 and unit is not null)),
  check (rule_type <> 'DISCOUNT_PERCENTAGE' or (numeric_value is not null and numeric_value between 0 and 1)),
  check (numeric_value is not null or text_value is not null),
  check (status not in ('CONFIRMED', 'ACTIVE') or (confirmed_by is not null and confirmed_at is not null)),
  check (status <> 'ACTIVE' or (activated_by is not null and activated_at is not null)),
  check (status <> 'REJECTED' or (rejected_by is not null and rejected_at is not null and rejection_reason is not null)),
  check ((status = 'SUPERSEDED') = (superseded_at is not null)),
  constraint contract_rules_no_overlap exclude using gist (
    contract_version_id with =,
    rule_type with =,
    (coalesce(unit, '')) with =,
    daterange(valid_from, valid_until, '[]') with &&
  ) where (status = 'ACTIVE')
);
create index contract_rules_version_idx on app.contract_rules (organization_id, contract_version_id, status);
create index contract_rules_contract_idx on app.contract_rules (organization_id, contract_id);
create trigger contract_rules_updated_at before update on app.contract_rules
  for each row execute function app.set_updated_at();
create trigger contract_rules_audit after insert or update on app.contract_rules
  for each row execute function app.audit_row();
create trigger contract_rules_no_delete before delete on app.contract_rules
  for each row execute function app.forbid_mutation();

-- Verificação literal do trecho + máquina de estados + imutabilidade de valores.
create or replace function app.contract_rules_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_needle text := app.normalize_excerpt(new.source_text);
  v_page int;
  v_version record;
  v_frozen text[] := array['rule_type', 'numeric_value', 'text_value', 'unit', 'valid_from', 'valid_until',
                           'source_document_id', 'source_page', 'source_text', 'contract_version_id',
                           'contract_id', 'organization_id', 'source_type', 'extraction_run_id',
                           'extracted_payload', 'extraction_confidence', 'currency'];
  v_col text;
begin
  if tg_op = 'INSERT' and new.status <> 'PROPOSED' then
    raise exception 'INVALID_STATE: regra deve nascer PROPOSED' using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' and old.status <> 'PROPOSED' then
    foreach v_col in array v_frozen loop
      if (to_jsonb(new) -> v_col) is distinct from (to_jsonb(old) -> v_col) then
        raise exception 'IMMUTABLE_FIELD: % não pode mudar após confirmação (crie nova regra)', v_col
          using errcode = 'P0001';
      end if;
    end loop;
  end if;

  if tg_op = 'UPDATE' and new.status <> old.status then
    if not (
      (old.status = 'PROPOSED' and new.status in ('CONFIRMED', 'REJECTED')) or
      (old.status = 'CONFIRMED' and new.status in ('ACTIVE', 'REJECTED')) or
      (old.status = 'ACTIVE' and new.status = 'SUPERSEDED')
    ) then
      raise exception 'INVALID_TRANSITION: % -> %', old.status, new.status using errcode = 'P0001';
    end if;
  elsif tg_op = 'UPDATE' and old.status in ('REJECTED', 'SUPERSEDED') then
    raise exception 'IMMUTABLE_RECORD: regra % é histórica', old.status using errcode = 'P0001';
  end if;

  -- (re)verificação do trecho enquanto a regra está PROPOSED
  if tg_op = 'INSERT' or old.status = 'PROPOSED' then
    select p.page_number into v_page
      from app.contract_document_pages p
     where p.document_id = new.source_document_id
       and p.organization_id = new.organization_id
       and (new.source_page is null or p.page_number = new.source_page)
       and length(v_needle) >= 3
       and position(v_needle in app.normalize_excerpt(p.text)) > 0
     order by p.page_number
     limit 1;
    new.source_verified := v_page is not null;
    if v_page is not null and new.source_page is null then
      new.source_page := v_page;
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status = 'CONFIRMED' and old.status = 'PROPOSED' and not new.source_verified then
    raise exception 'SOURCE_NOT_VERIFIED: o trecho citado não foi localizado no documento' using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' and new.status = 'ACTIVE' and old.status <> 'ACTIVE' then
    select status, valid_from, valid_until into v_version
      from app.contract_versions
     where id = new.contract_version_id and organization_id = new.organization_id;
    if v_version.status <> 'ACTIVE' then
      raise exception 'VERSION_NOT_ACTIVE: regras só podem ser ativadas em versão ACTIVE' using errcode = 'P0001';
    end if;
    -- o fim efetivo da regra é limitado pela versão (o motor usa a interseção)
    if new.valid_from < v_version.valid_from
       or (v_version.valid_until is not null and new.valid_from > v_version.valid_until) then
      raise exception 'RULE_OUTSIDE_VERSION: vigência da regra fora da vigência da versão' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger contract_rules_guard before insert or update on app.contract_rules
  for each row execute function app.contract_rules_guard();
