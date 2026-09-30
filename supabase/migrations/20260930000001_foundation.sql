-- =============================================================================
-- Revenue Intelligence — Fundação
-- Schema `app` (NÃO exposto na Data API — ADR-014), funções de autorização,
-- auditoria append-only, organizações, usuários, vínculos, materialidade e
-- registro de versões de motores.
-- Convenções (ADR-001): toda tabela de tenant tem organization_id NOT NULL,
-- UNIQUE (organization_id, id) e FKs compostas (organization_id, x_id).
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

create schema if not exists app;
revoke all on schema app from public;
revoke all on schema app from anon;
grant usage on schema app to authenticated, service_role;

-- Nada criado neste schema fica acessível por padrão.
alter default privileges in schema app revoke all on tables from public, anon, authenticated;
alter default privileges in schema app revoke all on functions from public, anon;
alter default privileges in schema app revoke all on sequences from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Utilitários genéricos
-- -----------------------------------------------------------------------------

create or replace function app.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function app.forbid_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'IMMUTABLE_RECORD: % em %.% não é permitido', tg_op, tg_table_schema, tg_table_name
    using errcode = 'P0001';
end $$;

-- Papel efetivo da transação (SET LOCAL ROLE). Dentro de funções SECURITY DEFINER
-- current_user é o dono; current_setting('role') preserva o papel do chamador.
create or replace function app.current_role_name() returns text
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('role', true), 'none'), current_user::text)
$$;

create or replace function app.current_user_id() returns uuid
language sql stable set search_path = '' as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
      nullif(current_setting('request.jwt.claim.sub', true), '')
    ), '')::uuid
$$;

-- Validação de CNPJ (numérico e alfanumérico).
-- Alfanumérico: IN RFB nº 2.229/2024 (a partir de 07/2026) — 12 posições [0-9A-Z]
-- + 2 DV numéricos; valor de cada caractere = código ASCII − 48; pesos módulo 11.
-- VERIFICAR contra a documentação técnica oficial da Receita Federal antes de produção.
create or replace function app.is_valid_cnpj(p text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  w1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  w2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  s int; r int; d1 int; d2 int; i int;
begin
  if p is null or p !~ '^[0-9A-Z]{12}[0-9]{2}$' then return false; end if;
  if p ~ '^([0-9])\1{13}$' then return false; end if;
  s := 0;
  for i in 1..12 loop s := s + (ascii(substr(p, i, 1)) - 48) * w1[i]; end loop;
  r := s % 11; d1 := case when r < 2 then 0 else 11 - r end;
  s := 0;
  for i in 1..13 loop
    s := s + (case when i = 13 then d1 else ascii(substr(p, i, 1)) - 48 end) * w2[i];
  end loop;
  r := s % 11; d2 := case when r < 2 then 0 else 11 - r end;
  return substr(p, 13, 1)::int = d1 and substr(p, 14, 1)::int = d2;
end $$;

-- -----------------------------------------------------------------------------
-- Organizações, usuários e vínculos
-- -----------------------------------------------------------------------------

create table app.organizations (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null check (length(btrim(legal_name)) between 1 and 300),
  trade_name text check (trade_name is null or length(btrim(trade_name)) between 1 and 300),
  cnpj text check (cnpj is null or app.is_valid_cnpj(cnpj)),
  timezone text not null default 'America/Sao_Paulo' check (length(timezone) between 1 and 64),
  currency text not null default 'BRL' check (currency = 'BRL'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index organizations_cnpj_uq on app.organizations (cnpj) where cnpj is not null and deleted_at is null;
create trigger organizations_updated_at before update on app.organizations
  for each row execute function app.set_updated_at();

create table app.users (
  id uuid primary key references auth.users (id) on delete restrict,
  email text not null check (length(email) between 3 and 320),
  full_name text check (full_name is null or length(full_name) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index users_email_uq on app.users (lower(email));
create trigger users_updated_at before update on app.users
  for each row execute function app.set_updated_at();

alter table app.organizations
  add constraint organizations_created_by_fk foreign key (created_by) references app.users (id);

create table app.organization_users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  user_id uuid not null references app.users (id),
  role text not null check (role in ('ADMIN', 'FINANCE', 'COMMERCIAL', 'AUDITOR', 'EXECUTIVE')),
  status text not null default 'INVITED' check (status in ('INVITED', 'ACTIVE', 'DISABLED')),
  invited_by uuid references app.users (id),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (organization_id, id),
  check (status <> 'ACTIVE' or joined_at is not null)
);
create index organization_users_user_idx on app.organization_users (user_id) where status = 'ACTIVE';
create trigger organization_users_updated_at before update on app.organization_users
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Funções de autorização (SECURITY DEFINER: evitam recursão de RLS)
-- -----------------------------------------------------------------------------

create or replace function app.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from app.organization_users ou
    join app.organizations o on o.id = ou.organization_id
    where ou.organization_id = p_org
      and ou.user_id = app.current_user_id()
      and ou.status = 'ACTIVE'
      and o.deleted_at is null
      and o.status = 'ACTIVE'
  )
$$;

create or replace function app.has_role(p_org uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from app.organization_users ou
    join app.organizations o on o.id = ou.organization_id
    where ou.organization_id = p_org
      and ou.user_id = app.current_user_id()
      and ou.status = 'ACTIVE'
      and ou.role = any (p_roles)
      and o.deleted_at is null
      and o.status = 'ACTIVE'
  )
$$;

create or replace function app.shares_organization(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user = app.current_user_id() or exists (
    select 1
    from app.organization_users me
    join app.organization_users other on other.organization_id = me.organization_id
    where me.user_id = app.current_user_id()
      and me.status = 'ACTIVE'
      and other.user_id = p_user
  )
$$;

-- Sempre deve existir ao menos um ADMIN ativo por organização.
create or replace function app.ensure_active_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'ADMIN' and old.status = 'ACTIVE'
     and (new.role <> 'ADMIN' or new.status <> 'ACTIVE') then
    if not exists (
      select 1 from app.organization_users
      where organization_id = old.organization_id
        and role = 'ADMIN' and status = 'ACTIVE' and id <> old.id
    ) then
      raise exception 'LAST_ADMIN: a organização precisa de ao menos um ADMIN ativo'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger organization_users_last_admin after update on app.organization_users
  for each row execute function app.ensure_active_admin();

-- Vínculo: organization_id e user_id nunca mudam.
create or replace function app.organization_users_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.organization_id <> old.organization_id or new.user_id <> old.user_id then
    raise exception 'IMMUTABLE_FIELD: vínculo não pode trocar de organização/usuário' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger organization_users_guard before update on app.organization_users
  for each row execute function app.organization_users_guard();

-- Espelho de auth.users em app.users.
create or replace function app.handle_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into app.users (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, new.id::text || '@unknown.invalid'),
    nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 200), '')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;
create trigger on_auth_user_created after insert or update of email on auth.users
  for each row execute function app.handle_auth_user();

-- -----------------------------------------------------------------------------
-- Auditoria append-only
-- -----------------------------------------------------------------------------

create table app.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references app.organizations (id),
  actor_user_id uuid,
  actor_type text not null check (actor_type in ('USER', 'SYSTEM')),
  action text not null check (length(action) between 1 and 120),
  entity_type text not null check (length(entity_type) between 1 and 80),
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_org_created_idx on app.audit_logs (organization_id, created_at desc);
create index audit_logs_entity_idx on app.audit_logs (organization_id, entity_type, entity_id);
create trigger audit_logs_immutable before update or delete on app.audit_logs
  for each row execute function app.forbid_mutation();
create trigger audit_logs_no_truncate before truncate on app.audit_logs
  for each statement execute function app.forbid_mutation();

-- Ator: via usuário (authenticated) sempre auth.uid() do JWT; via sistema
-- (service_role) o usuário que disparou vem de app.actor_user_id (setado pelo servidor).
create or replace function app.audit_actor(out actor_type text, out actor_user_id uuid)
language plpgsql stable set search_path = '' as $$
begin
  if app.current_role_name() = 'authenticated' then
    actor_type := 'USER';
    actor_user_id := app.current_user_id();
  else
    actor_type := 'SYSTEM';
    actor_user_id := coalesce(
      nullif(current_setting('app.actor_user_id', true), '')::uuid,
      app.current_user_id()
    );
  end if;
end $$;

-- Trigger genérico. TG_ARGV: colunas a excluir do snapshot (conteúdo volumoso).
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_org uuid;
  v_entity uuid;
  v_actor record;
  v_col text;
  v_intent text := nullif(current_setting('app.audit_action', true), '');
begin
  if tg_op in ('UPDATE', 'DELETE') then v_before := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_after := to_jsonb(new); end if;

  if tg_nargs > 0 then
    foreach v_col in array tg_argv loop
      v_before := v_before - v_col;
      v_after := v_after - v_col;
    end loop;
  end if;

  if tg_op = 'UPDATE' and (v_before - 'updated_at') = (v_after - 'updated_at') then
    return null;
  end if;

  v_entity := coalesce(v_after ->> 'id', v_before ->> 'id')::uuid;
  if tg_table_name = 'organizations' then
    v_org := v_entity;
  else
    v_org := coalesce(v_after ->> 'organization_id', v_before ->> 'organization_id')::uuid;
  end if;

  select * into v_actor from app.audit_actor();

  insert into app.audit_logs
    (organization_id, actor_user_id, actor_type, action, entity_type, entity_id,
     before_data, after_data, metadata)
  values
    (v_org, v_actor.actor_user_id, v_actor.actor_type,
     tg_table_name || '.' || lower(tg_op), tg_table_name, v_entity,
     v_before, v_after,
     case when v_intent is null then null else jsonb_build_object('intent', v_intent) end);
  return null;
end $$;

-- Registro explícito de ações que não alteram linhas (ex.: download de documento).
create or replace function app.write_audit(
  p_org uuid, p_action text, p_entity_type text, p_entity_id uuid, p_metadata jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor record;
begin
  if app.current_role_name() = 'authenticated' and not app.is_member(p_org) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_actor from app.audit_actor();
  insert into app.audit_logs (organization_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  values (p_org, v_actor.actor_user_id, v_actor.actor_type, p_action, p_entity_type, p_entity_id, p_metadata);
end $$;

create trigger organizations_audit after insert or update on app.organizations
  for each row execute function app.audit_row();
create trigger organization_users_audit after insert or update on app.organization_users
  for each row execute function app.audit_row();

-- -----------------------------------------------------------------------------
-- Registro de motores (global, não pertence a tenant)
-- -----------------------------------------------------------------------------

create table app.engine_registry (
  engine_name text not null check (engine_name ~ '^[a-z_]{3,80}$'),
  engine_version text not null check (engine_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  deployed_at timestamptz not null default now(),
  description text not null,
  change_summary text not null,
  calculation_breaking_change boolean not null,
  created_at timestamptz not null default now(),
  primary key (engine_name, engine_version)
);
create trigger engine_registry_immutable before update or delete on app.engine_registry
  for each row execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Materialidade (versionada por organização — ADR-020)
-- -----------------------------------------------------------------------------

create table app.materiality_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  version integer not null check (version > 0),
  mode text not null check (mode in ('ABSOLUTE', 'PERCENTAGE', 'COMBINED')),
  absolute_threshold numeric(18, 2) check (absolute_threshold is null or absolute_threshold >= 0),
  -- fração: 0.01 = 1%
  percentage_threshold numeric(12, 8) check (percentage_threshold is null or percentage_threshold between 0 and 1),
  combination_operator text check (combination_operator in ('AND', 'OR')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUPERSEDED')),
  created_by uuid references app.users (id),
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  unique (organization_id, id),
  unique (organization_id, version),
  check (mode <> 'ABSOLUTE' or (absolute_threshold is not null and percentage_threshold is null and combination_operator is null)),
  check (mode <> 'PERCENTAGE' or (percentage_threshold is not null and absolute_threshold is null and combination_operator is null)),
  check (mode <> 'COMBINED' or (absolute_threshold is not null and percentage_threshold is not null and combination_operator is not null)),
  check ((status = 'SUPERSEDED') = (superseded_at is not null))
);
create unique index materiality_one_active on app.materiality_policies (organization_id) where status = 'ACTIVE';

create or replace function app.materiality_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'SUPERSEDED' then
    raise exception 'IMMUTABLE_RECORD: política de materialidade substituída' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - 'status' - 'superseded_at') <> (to_jsonb(old) - 'status' - 'superseded_at')
     or new.status <> 'SUPERSEDED' then
    raise exception 'IMMUTABLE_RECORD: materialidade só pode ser substituída por nova versão' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger materiality_policies_guard before update on app.materiality_policies
  for each row execute function app.materiality_guard();
create trigger materiality_policies_no_delete before delete on app.materiality_policies
  for each row execute function app.forbid_mutation();
create trigger materiality_policies_audit after insert or update on app.materiality_policies
  for each row execute function app.audit_row();

-- Troca de política: substitui a ativa e cria nova versão (SECURITY INVOKER: RLS se aplica).
create or replace function app.set_materiality_policy(
  p_org uuid, p_mode text, p_absolute numeric, p_percentage numeric, p_operator text
) returns uuid
language plpgsql set search_path = '' as $$
declare v_next int; v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('materiality:' || p_org::text, 0));
  select coalesce(max(version), 0) + 1 into v_next
    from app.materiality_policies where organization_id = p_org;
  update app.materiality_policies
     set status = 'SUPERSEDED', superseded_at = now()
   where organization_id = p_org and status = 'ACTIVE';
  insert into app.materiality_policies
    (organization_id, version, mode, absolute_threshold, percentage_threshold, combination_operator, created_by)
  values
    (p_org, v_next, p_mode, p_absolute, p_percentage, p_operator, app.current_user_id())
  returning id into v_id;
  return v_id;
end $$;

-- Criação de organização pelo próprio usuário: vira ADMIN; política padrão
-- COMBINED R$ 500 AND 1% (ADR-020).
create or replace function app.create_organization(p_legal_name text, p_trade_name text, p_cnpj text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := app.current_user_id(); v_org uuid;
begin
  if v_user is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if not exists (select 1 from app.users where id = v_user) then
    raise exception 'USER_PROFILE_MISSING' using errcode = 'P0001';
  end if;
  insert into app.organizations (legal_name, trade_name, cnpj, created_by)
  values (btrim(p_legal_name), nullif(btrim(coalesce(p_trade_name, '')), ''), p_cnpj, v_user)
  returning id into v_org;
  insert into app.organization_users (organization_id, user_id, role, status, joined_at)
  values (v_org, v_user, 'ADMIN', 'ACTIVE', now());
  insert into app.materiality_policies
    (organization_id, version, mode, absolute_threshold, percentage_threshold, combination_operator, created_by)
  values (v_org, 1, 'COMBINED', 500.00, 0.01, 'AND', v_user);
  return v_org;
end $$;

-- Aceite de convites pendentes pelo próprio usuário convidado.
create or replace function app.accept_pending_invitations() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  if app.current_user_id() is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  update app.organization_users
     set status = 'ACTIVE', joined_at = now()
   where user_id = app.current_user_id() and status = 'INVITED';
  get diagnostics v_count = row_count;
  return v_count;
end $$;
