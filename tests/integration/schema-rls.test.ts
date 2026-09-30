import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool } from "@/infrastructure/db/client";
import { adminSql, asSystem, asUser, createOrg, createUser, expectDbError, makeCnpj, type OrgFixture } from "./helpers";
import { confirmAndActivate, insertManualRule, seedCanonicalRules, seedContract, type ContractFixture } from "./fixtures";

let A: OrgFixture;
let B: OrgFixture;
let kA: ContractFixture;
let kB: ContractFixture;

beforeAll(async () => {
  A = await createOrg("OrgA");
  B = await createOrg("OrgB");
  kA = await seedContract(A);
  kB = await seedContract(B);
  await seedCanonicalRules(B, kB);
});

afterAll(async () => {
  await closePool();
});

describe("Fundação do schema", () => {
  it("toda tabela do schema app tem RLS habilitado", async () => {
    const rows = await adminSql()`select tablename from pg_tables where schemaname = 'app' and not rowsecurity`;
    expect(rows).toEqual([]);
  });

  it("nenhuma política de DELETE existe e authenticated não tem privilégio de DELETE", async () => {
    const policies = await adminSql()`select tablename from pg_policies where schemaname = 'app' and cmd in ('DELETE', 'ALL')`;
    expect(policies).toEqual([]);
    const grants = await adminSql()`
      select table_name from information_schema.role_table_grants
      where table_schema = 'app' and grantee in ('authenticated', 'service_role', 'anon') and privilege_type in ('DELETE', 'TRUNCATE')`;
    expect(grants).toEqual([]);
  });

  it("anon não tem acesso ao schema app", async () => {
    const [r] = await adminSql()`select has_schema_privilege('anon', 'app', 'usage') as ok`;
    expect(r!.ok).toBe(false);
  });

  it("colunas monetárias nunca usam float", async () => {
    const rows = await adminSql()`
      select table_name, column_name from information_schema.columns
      where table_schema = 'app' and data_type in ('real', 'double precision')`;
    expect(rows).toEqual([]);
  });
});

describe("TESTE 5 — isolamento cross-tenant", () => {
  it("usuário de A não enxerga nenhuma linha de B em nenhuma tabela de tenant", async () => {
    const tables = await adminSql()`
      select table_name from information_schema.columns
      where table_schema = 'app' and column_name = 'organization_id'
      group by table_name order by table_name`;
    expect(tables.length).toBeGreaterThan(20);
    for (const role of ["ADMIN", "FINANCE", "COMMERCIAL", "AUDITOR", "EXECUTIVE"] as const) {
      await asUser(A.members[role], async (tx) => {
        for (const { table_name } of tables) {
          const [r] = await tx.unsafe(`select count(*)::int as n from app.${table_name} where organization_id = $1`, [B.orgId]);
          expect({ table: table_name, role, n: r!.n }).toEqual({ table: table_name, role, n: 0 });
        }
        const orgs = await tx`select id from app.organizations`;
        expect(orgs.map((o) => o.id)).toEqual([A.orgId]);
      });
    }
  });

  it("ADMIN de A lendo o contrato de B por id recebe DENIED (vazio) e não consegue alterá-lo", async () => {
    await asUser(A.adminId, async (tx) => {
      expect(await tx`select * from app.contracts where id = ${kB.contractId}`).toHaveLength(0);
      const upd = await tx`update app.contracts set title = 'hack' where id = ${kB.contractId}`;
      expect(upd.count).toBe(0);
    });
    const [c] = await adminSql()`select title from app.contracts where id = ${kB.contractId}`;
    expect(c!.title).toBe("Suporte técnico");
  });

  it("não é possível inserir dado na organização B", async () => {
    await expectDbError(
      asUser(A.adminId, (tx) => tx`
        insert into app.customers (organization_id, legal_name, legal_name_normalized)
        values (${B.orgId}, 'Invasor', 'invasor')`),
      /row-level security/,
    );
  });

  it("FK composta impede referência a entidade de outro tenant (mesmo com service_role)", async () => {
    await expectDbError(
      asSystem(null, (tx) => tx`
        insert into app.contracts (organization_id, customer_id, contract_number, title, start_date)
        values (${A.orgId}, ${kB.customerId}, 'X-1', 'Cruzado', '2026-01-01')`),
      /foreign key/,
    );
  });

  it("membro desativado perde acesso imediatamente", async () => {
    const uid = await createUser("temp");
    await asUser(A.adminId, (tx) => tx`insert into app.organization_users (organization_id, user_id, role, status)
                                       values (${A.orgId}, ${uid}, 'FINANCE', 'INVITED')`);
    await asUser(uid, (tx) => tx`select app.accept_pending_invitations()`);
    expect(await asUser(uid, (tx) => tx`select id from app.customers`)).not.toHaveLength(0);
    await asUser(A.adminId, (tx) => tx`update app.organization_users set status = 'DISABLED' where user_id = ${uid}`);
    expect(await asUser(uid, (tx) => tx`select id from app.customers`)).toHaveLength(0);
  });
});

describe("Permissões verticais (menor privilégio)", () => {
  it("EXECUTIVE e FINANCE não criam clientes; COMMERCIAL cria", async () => {
    for (const role of ["EXECUTIVE", "FINANCE", "AUDITOR"] as const) {
      await expectDbError(
        asUser(A.members[role], (tx) => tx`
          insert into app.customers (organization_id, legal_name, legal_name_normalized)
          values (${A.orgId}, 'X', 'x')`),
        /row-level security/,
      );
    }
    await asUser(A.members.COMMERCIAL, (tx) => tx`
      insert into app.customers (organization_id, legal_name, legal_name_normalized)
      values (${A.orgId}, 'Cliente Comercial', 'cliente comercial')`);
  });

  it("COMMERCIAL propõe regra mas não confirma", async () => {
    const ruleId = await asUser(A.members.COMMERCIAL, async (tx) => {
      const [r] = await tx`
        insert into app.contract_rules (organization_id, contract_id, contract_version_id, rule_type, numeric_value,
          valid_from, source_type, source_document_id, source_text)
        values (${A.orgId}, ${kA.contractId}, ${kA.versionId}, 'FIXED_MONTHLY_FEE', 18000, '2026-01-01',
          'MANUAL_ENTRY', ${kA.documentId}, 'mensalidade fixa de R$ 18.000,00') returning id`;
      return r!.id as string;
    });
    const upd = await asUser(A.members.COMMERCIAL, (tx) =>
      tx`update app.contract_rules set status = 'CONFIRMED', confirmed_by = ${A.members.COMMERCIAL}, confirmed_at = now() where id = ${ruleId}`);
    expect(upd.count).toBe(0);
  });

  it("somente ADMIN e AUDITOR leem audit_logs", async () => {
    for (const role of ["FINANCE", "COMMERCIAL", "EXECUTIVE"] as const) {
      const rows = await asUser(A.members[role], (tx) => tx`select id from app.audit_logs`);
      expect(rows).toHaveLength(0);
    }
    for (const role of ["ADMIN", "AUDITOR"] as const) {
      const rows = await asUser(A.members[role], (tx) => tx`select id from app.audit_logs`);
      expect(rows.length).toBeGreaterThan(0);
    }
  });

  it("não é possível remover o último ADMIN", async () => {
    await expectDbError(
      asUser(A.adminId, (tx) => tx`update app.organization_users set role = 'FINANCE' where user_id = ${A.adminId}`),
      /LAST_ADMIN/,
    );
  });
});

describe("AuditLog append-only", () => {
  it("ninguém altera ou apaga auditoria, nem service_role", async () => {
    await expectDbError(asSystem(null, (tx) => tx`update app.audit_logs set action = 'x'`), /IMMUTABLE_RECORD|permission denied/);
    await expectDbError(asSystem(null, (tx) => tx`delete from app.audit_logs`), /IMMUTABLE_RECORD|permission denied/);
    await expectDbError(
      asUser(A.adminId, (tx) => tx`insert into app.audit_logs (organization_id, actor_type, action, entity_type) values (${A.orgId}, 'USER', 'fake', 'x')`),
      /permission denied/,
    );
  });

  it("alterações registram ator, antes e depois", async () => {
    await asUser(A.adminId, (tx) => tx`update app.customers set trade_name = 'ABC' where id = ${kA.customerId}`);
    const [log] = await adminSql()`
      select actor_user_id, actor_type, before_data->>'trade_name' as before, after_data->>'trade_name' as after
      from app.audit_logs where entity_id = ${kA.customerId} and action = 'customers.update'
      order by created_at desc limit 1`;
    expect(log).toMatchObject({ actor_user_id: A.adminId, actor_type: "USER", before: null, after: "ABC" });
  });
});

describe("Integridade de domínio no banco", () => {
  it("CNPJ inválido é rejeitado; válido e alfanumérico (IN RFB 2.229/2024) aceitos", async () => {
    const [r] = await adminSql()`select app.is_valid_cnpj('11222333000181') a, app.is_valid_cnpj('11222333000182') b,
                                        app.is_valid_cnpj('11111111111111') c, app.is_valid_cnpj('12ABC34501DE35') d`;
    expect(r).toEqual({ a: true, b: false, c: false, d: true });
    expect(await adminSql()`select app.is_valid_cnpj(${makeCnpj(42)}) ok`).toEqual([{ ok: true }]);
  });

  it("competência fora do dia 1 é rejeitada", async () => {
    await expectDbError(
      asUser(A.adminId, (tx) => tx`
        insert into app.operational_events (organization_id, customer_id, competence, event_type, quantity, unit, dedup_key, source_type)
        values (${A.orgId}, ${kA.customerId}, '2026-09-15', 'HOURS', 1, 'HOUR', 'manual:x1', 'MANUAL_ENTRY')`),
      /check constraint/,
    );
  });

  it("versões ativas do mesmo contrato não se sobrepõem", async () => {
    await expectDbError(
      asUser(A.adminId, (tx) => tx`
        insert into app.contract_versions (organization_id, contract_id, version_number, valid_from, source_type)
        values (${A.orgId}, ${kA.contractId}, 2, '2026-07-01', 'AMENDMENT')`),
      /contract_versions_no_overlap|exclusion/,
    );
  });

  it("regra só é confirmada com trecho verificado no documento", async () => {
    const ruleId = await insertManualRule(A, kA, { type: "FIXED_MONTHLY_FEE", value: "99999.00", excerpt: "texto que não existe no contrato" });
    const [r] = await adminSql()`select source_verified from app.contract_rules where id = ${ruleId}`;
    expect(r!.source_verified).toBe(false);
    await expectDbError(confirmAndActivate(A, ruleId), /SOURCE_NOT_VERIFIED/);
  });

  it("regra confirmada é imutável e não volta de estado", async () => {
    const ruleId = await insertManualRule(A, kA, { type: "INCLUDED_QUANTITY", value: "40", unit: "HOUR", excerpt: "Estão incluídas 40 horas mensais" });
    const [r] = await adminSql()`select source_verified, source_page from app.contract_rules where id = ${ruleId}`;
    expect(r).toEqual({ source_verified: true, source_page: 1 });
    await confirmAndActivate(A, ruleId);
    await expectDbError(asUser(A.adminId, (tx) => tx`update app.contract_rules set numeric_value = 50 where id = ${ruleId}`), /IMMUTABLE_FIELD/);
    await expectDbError(asUser(A.adminId, (tx) => tx`update app.contract_rules set status = 'PROPOSED' where id = ${ruleId}`), /INVALID_TRANSITION/);
  });

  it("duas regras ACTIVE iguais para o mesmo período são rejeitadas", async () => {
    const r1 = await insertManualRule(A, kA, { type: "EXCESS_UNIT_PRICE", value: "280", unit: "HOUR", excerpt: "Cada hora adicional será faturada a R$ 280,00" });
    const r2 = await insertManualRule(A, kA, { type: "EXCESS_UNIT_PRICE", value: "280", unit: "HOUR", excerpt: "Cada hora adicional será faturada a R$ 280,00" });
    await confirmAndActivate(A, r1);
    await expectDbError(confirmAndActivate(A, r2), /contract_rules_no_overlap|exclusion/);
  });

  it("valor monetário com mais de 2 casas é rejeitado em regra de mensalidade", async () => {
    await expectDbError(
      insertManualRule(A, kA, { type: "FIXED_MONTHLY_FEE", value: "18000.123", excerpt: "mensalidade fixa de R$ 18.000,00" }),
      /check constraint/,
    );
  });

  it("usuários não escrevem diretamente em tabelas de saída de motor", async () => {
    await expectDbError(
      asUser(A.adminId, (tx) => tx`
        insert into app.calculation_runs (organization_id, engine_name, engine_version, calculation_type, scope_id,
          contract_id, competence, status, input_snapshot, input_snapshot_hash, triggered_by_type, triggered_by_user_id)
        values (${A.orgId}, 'expected_revenue_engine', '1.0.0', 'EXPECTED_REVENUE', ${kA.contractId}, ${kA.contractId},
          '2026-09-01', 'RUNNING', '{}', ${"0".repeat(64)}, 'USER', ${A.adminId})`),
      /permission denied/,
    );
  });
});
