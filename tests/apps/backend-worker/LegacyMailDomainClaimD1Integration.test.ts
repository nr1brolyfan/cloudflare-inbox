/* oxlint-disable vitest/max-expects -- Migration protocol cases assert each atomic state together. */
import { DatabaseSync } from "node:sqlite";

import type { D1EffectQbDatabaseLike } from "@effect-auth/core/EffectQbSqliteStorage";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

import { LegacyMailDomainClaimStoreD1Layer } from "#/apps/backend-worker/LegacyMailDomainClaimD1Integration";
import { LegacyMailDomainClaimReconciler } from "#/modules/organization/application/LegacyMailDomainClaimReconciliation";
import {
  MailboxBootstrapConfig,
  parseMailboxBootstrapConfig,
} from "#/modules/organization/contracts/MailboxBootstrapConfig";
import { LegacyMailDomainClaimStore } from "#/modules/organization/ports/LegacyMailDomainClaimStore";
import { ControlPlaneD1Layer } from "#/platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneD1Binding } from "#/platform/control-plane-d1/ControlPlaneDatabase";

import {
  applyControlPlaneMigration,
  applyControlPlaneMigrations,
  applyControlPlaneMigrationsThrough,
  makeTestD1Database,
} from "../../support/d1";

const migration = "1026_app_legacy_mail_domain_claim.sql";
const operationId = "00000000-0000-4000-8000-000000000010";
const auditEventId = `admin-audit-sha256:${"a".repeat(64)}`;

const withoutTriggers = (
  database: DatabaseSync,
  names: readonly string[],
  mutation: () => void
) => {
  const definitions = names.map((name) => {
    const row = database
      .prepare(
        "select sql from sqlite_master where type = 'trigger' and name = ?"
      )
      .get(name) as { readonly sql: string } | undefined;
    if (row === undefined) {
      throw new Error(`Missing fixture trigger ${name}`);
    }
    return row.sql;
  });
  for (const name of names) {
    database.exec(`drop trigger "${name}"`);
  }
  mutation();
  for (const definition of definitions) {
    database.exec(definition);
  }
};

const insertOrphanBootstrapHistory = (
  database: DatabaseSync,
  kind: "audit" | "domain-intent" | "receipt" | "v1" | "v2"
) => {
  const triggers = [
    "app_mailbox_administration_receipt_binding",
    "app_mailbox_bootstrap_receipt_v1_intent_from_parent",
    "app_mailbox_bootstrap_receipt_v1_intent_binding",
    "app_mailbox_bootstrap_receipt_v2_binding",
    "app_organization_owner_assignment_from_bootstrap_audit",
    ...(kind === "domain-intent"
      ? ["app_mailbox_bootstrap_domain_intent_binding"]
      : []),
  ];
  database.exec("pragma foreign_keys = off");
  withoutTriggers(database, triggers, () => {
    if (kind !== "audit") {
      database.exec(`insert into app_mailbox_administration_receipt
        (operation_id, operation_kind, actor_user_id, mailbox_id, display_name,
         expected_version, result_mailbox_id, result_display_name,
         result_status, result_created_by_user_id, result_created_at,
         result_updated_at, result_version, committed_at, schema_version)
        values ('${operationId}', 'bootstrap-owner', 'orphan-user', 'primary',
          'Inbox', null, 'primary', 'Inbox', 'active', 'orphan-user', 1000,
          1000, 1, 1000, 1)`);
    }
    if (kind === "v1") {
      database.exec(`insert into app_mailbox_bootstrap_receipt_v1_intent
        (operation_id, initial_address)
        values ('${operationId}', 'inbox@example.test')`);
    } else if (kind === "v2") {
      database.exec(`insert into app_mailbox_bootstrap_receipt_v2
        (operation_id, initial_address, schema_version)
        values ('${operationId}', 'inbox@example.test', 2)`);
    } else if (kind === "domain-intent") {
      database.exec(`insert into app_mailbox_bootstrap_domain_intent
        (operation_id, canonical_domain, canonicalization_profile_id,
         canonicalization_version, schema_version)
        values ('${operationId}', 'example.test',
          'mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1',
          1, 1)`);
    } else if (kind === "audit") {
      database.exec(`insert into app_administrative_audit_event
        (event_id, schema_version, event_version, operation_id, action,
         outcome, actor_type, actor_id, tenant_scope_type, tenant_scope_id,
         resource_type, resource_id, reason_code, change_type,
         resource_version_before, resource_version_after, occurred_at)
        values ('${auditEventId}', 1, 1, '${operationId}',
          'mailbox.owner-bootstrap', 'succeeded', 'user', 'orphan-user',
          'legacy-mailbox', 'primary', 'mailbox', 'primary',
          'owner-bootstrap', 'mailbox-bootstrapped', null, 1, 1000)`);
    }
  });
  database.exec("pragma foreign_keys = on");
};

const insertFreshBootstrap = (
  database: DatabaseSync,
  domain: string,
  staged: boolean
) => {
  database.exec("begin immediate");
  try {
    database.exec(`
      insert into auth_user (id, created_at, updated_at)
      values ('user-a', 1000, 1000);
      insert into app_organization (id, created_at, updated_at)
      values ('legacy_default_v1', 1000, 1000);
      insert into app_mailbox
        (id, display_name, status, created_by_user_id, created_at, updated_at,
         version)
      values ('primary', 'Inbox', 'active', 'user-a', 1000, 1000, 1);
      insert into app_mailbox_address
        (mailbox_id, id, address, normalized_address, is_primary, enabled,
         created_at, updated_at)
      values ('primary', 'primary', 'inbox@${domain}', 'inbox@${domain}',
        1, 1, 1000, 1000);
      insert into app_mailbox_member
        (mailbox_id, user_id, created_at, updated_at)
      values ('primary', 'user-a', 1000, 1000);
      insert into auth_role_grant
        (subject_type, subject_id, role_id, scope_type, scope_id_present,
         scope_id)
      values ('user', 'user-a', 'owner', 'mailbox', 1, 'primary');
      insert into app_mailbox_administration_receipt
        (operation_id, operation_kind, actor_user_id, mailbox_id, display_name,
         expected_version, result_mailbox_id, result_display_name,
         result_status, result_created_by_user_id, result_created_at,
         result_updated_at, result_version, committed_at, schema_version)
      values ('${operationId}', 'bootstrap-owner', 'user-a', 'primary',
        'Inbox', null, 'primary', 'Inbox', 'active', 'user-a', 1000, 1000,
        1, 1000, 1);
    `);
    if (staged) {
      database.exec(`
        insert into app_mailbox_bootstrap_receipt_v2
          (operation_id, initial_address, schema_version)
        values ('${operationId}', 'inbox@${domain}', 2);
        insert into app_mailbox_bootstrap_domain_intent
          (operation_id, canonical_domain, canonicalization_profile_id,
           canonicalization_version, schema_version)
        values ('${operationId}', '${domain}',
          'mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1',
          1, 1);
      `);
    }
    database.exec(`
      insert into app_administrative_audit_event
        (event_id, schema_version, event_version, operation_id, action,
         outcome, actor_type, actor_id, tenant_scope_type, tenant_scope_id,
         resource_type, resource_id, request_id, correlation_id, reason_code,
         change_type, resource_version_before, resource_version_after,
         occurred_at)
      values ('${auditEventId}', 1, 1, '${operationId}',
        'mailbox.owner-bootstrap', 'succeeded', 'user', 'user-a',
        'legacy-mailbox', 'primary', 'mailbox', 'primary', null, null,
        'owner-bootstrap', 'mailbox-bootstrapped', null, 1, 1000);
    `);
    database.exec("commit");
  } catch (error) {
    database.exec("rollback");
    throw error;
  }
};

const makeLegacyDatabase = async (
  domain: string,
  applyClaimMigration = true
) => {
  const database = new DatabaseSync(":memory:");
  await applyControlPlaneMigrationsThrough(
    database,
    "1022_app_mailbox_bootstrap_receipt_v2.sql"
  );
  database.exec(`
    insert into auth_user (id, created_at, updated_at)
    values ('user-a', 1000, 1000);
    insert into app_mailbox
      (id, display_name, status, created_by_user_id, created_at, updated_at,
       version)
    values ('primary', 'Inbox', 'active', 'user-a', 1000, 1000, 1);
    insert into app_mailbox_member
      (mailbox_id, user_id, created_at, updated_at)
    values ('primary', 'user-a', 1000, 1000);
    insert into app_mailbox_address
      (mailbox_id, id, address, normalized_address, is_primary, enabled,
       created_at, updated_at)
    values ('primary', 'primary', 'inbox@${domain}', 'inbox@${domain}',
      1, 1, 1000, 1000);
    insert into auth_role_grant
      (subject_type, subject_id, role_id, scope_type, scope_id_present,
       scope_id, expires_at, metadata, revoked_at)
    values ('user', 'user-a', 'owner', 'mailbox', 1, 'primary', null, null,
      null);
  `);
  await applyControlPlaneMigration(
    database,
    "1023_app_organization_legacy_cutover.sql"
  );
  await applyControlPlaneMigration(
    database,
    "1024_app_mailbox_legacy_organization_assignment.sql"
  );
  await applyControlPlaneMigration(
    database,
    "1025_app_organization_owner_assignment.sql"
  );
  if (applyClaimMigration) {
    await applyControlPlaneMigration(database, migration);
  }
  return database;
};

const initialize = async (database: DatabaseSync, domain: string) => {
  const config = await Effect.runPromise(
    parseMailboxBootstrapConfig(`["owner@${domain}"]`, `inbox@${domain}`)
  );
  const binding = Layer.succeed(
    ControlPlaneD1Binding,
    ControlPlaneD1Binding.of({
      database: makeTestD1Database(database) as unknown as D1Database,
    })
  );
  const layer = LegacyMailDomainClaimReconciler.layerNoDeps.pipe(
    Layer.provide(LegacyMailDomainClaimStoreD1Layer),
    Layer.provide(ControlPlaneD1Layer),
    Layer.provide(binding),
    Layer.provide(
      Layer.succeed(MailboxBootstrapConfig, MailboxBootstrapConfig.of(config))
    )
  );
  return Effect.runPromise(
    Effect.gen(function* () {
      const reconciler = yield* LegacyMailDomainClaimReconciler;
      return yield* reconciler.initialize;
    }).pipe(Effect.provide(layer))
  );
};

const inspect = (
  database: DatabaseSync,
  d1: D1EffectQbDatabaseLike = makeTestD1Database(database)
) => {
  const binding = Layer.succeed(
    ControlPlaneD1Binding,
    ControlPlaneD1Binding.of({
      database: d1 as unknown as D1Database,
    })
  );
  return Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* LegacyMailDomainClaimStore;
      return yield* store.inspect;
    }).pipe(
      Effect.provide(LegacyMailDomainClaimStoreD1Layer),
      Effect.provide(ControlPlaneD1Layer),
      Effect.provide(binding)
    )
  );
};

describe("legacy mail domain claim", () => {
  it.each(["example.test", "xn--bcher-kva.example"])(
    "reconciles the pinned TypeScript canonical domain %s",
    async (domain) => {
      const database = await makeLegacyDatabase(domain);
      try {
        const inspected = await inspect(database);
        expect(inspected.routes).toStrictEqual([
          {
            address: `inbox@${domain}`,
            createdAt: 1000,
            enabled: 1,
            id: "primary",
            isPrimary: 1,
            mailboxId: "primary",
            normalizedAddress: `inbox@${domain}`,
            updatedAt: 1000,
            version: 1,
          },
        ]);
        expect(
          database.prepare("select * from app_mail_domain").all()
        ).toStrictEqual([]);

        await expect(initialize(database, domain)).resolves.toMatchObject({
          outcome: "reconciled",
        });
        expect(
          database
            .prepare(
              `select id, organization_id, canonical_domain, status, version
                 from app_mail_domain`
            )
            .get()
        ).toMatchObject({
          canonical_domain: domain,
          id: "legacy_default_v1_domain_v1",
          organization_id: "legacy_default_v1",
          status: "pending_verification",
          version: 1,
        });
        expect(
          database.prepare("select * from app_mail_domain_claim_receipt").get()
        ).toMatchObject({
          canonical_domain: domain,
          effective_at: 1000,
          normalized_address_snapshot: `inbox@${domain}`,
          primary_address_id: "primary",
          raw_address_snapshot: `inbox@${domain}`,
          schema_version: 1,
          source: "legacy-reconciliation",
        });
        await expect(initialize(database, domain)).resolves.toMatchObject({
          outcome: "validated",
        });
      } finally {
        database.close();
      }
    }
  );

  it("leaves a populated route awaiting application reconciliation", async () => {
    const database = await makeLegacyDatabase("example.test");
    try {
      expect(
        database.prepare("select * from app_mail_domain").all()
      ).toStrictEqual([]);
      expect(
        database.prepare("select * from app_mail_domain_claim_cutover").get()
      ).toMatchObject({
        initial_outcome: "legacy-awaiting-reconciliation",
        initial_status: "awaiting-reconciliation",
      });
    } finally {
      database.close();
    }
  });

  it("reads every inspection projection in one D1 batch", async () => {
    const database = await makeLegacyDatabase("example.test");
    try {
      const base = makeTestD1Database(database);
      let batchCalls = 0;
      const d1: D1EffectQbDatabaseLike = {
        ...base,
        batch: (statements) => {
          batchCalls += 1;
          return base.batch(statements);
        },
      };
      const snapshot = await inspect(database, d1);
      expect(batchCalls).toBe(1);
      expect(snapshot.claimCutovers).toHaveLength(1);
      expect(snapshot.routes).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("sanitizes transactional inspection batch failure", async () => {
    const database = await makeLegacyDatabase("example.test");
    try {
      const base = makeTestD1Database(database);
      const d1: D1EffectQbDatabaseLike = {
        ...base,
        batch: () => Promise.reject(new Error("restricted-storage-detail")),
      };
      await expect(inspect(database, d1)).rejects.toMatchObject({
        _tag: "LegacyMailDomainClaimStoreError",
      });
    } finally {
      database.close();
    }
  });

  it("serializes reconciliation inspection after a concurrent bootstrap", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const base = makeTestD1Database(database);
      let inserted = false;
      const d1: D1EffectQbDatabaseLike = {
        ...base,
        batch: (statements) => {
          if (!inserted) {
            inserted = true;
            insertFreshBootstrap(database, "example.test", false);
          }
          return base.batch(statements);
        },
      };
      const snapshot = await inspect(database, d1);
      expect(snapshot.domains).toHaveLength(1);
      await expect(initialize(database, "example.test")).resolves.toMatchObject(
        { outcome: "validated" }
      );
    } finally {
      database.close();
    }
  });

  it("is a fresh-empty no-op", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      database.exec(`insert into auth_user (id, created_at, updated_at)
        values ('pre-bootstrap-user', 1000, 1000)`);
      await expect(initialize(database, "example.test")).resolves.toMatchObject(
        {
          outcome: "fresh-empty",
        }
      );
      expect(
        database.prepare("select * from app_mail_domain").all()
      ).toStrictEqual([]);
    } finally {
      database.close();
    }
  });

  it("rejects malformed populated state without leaking its values", async () => {
    const database = await makeLegacyDatabase("xn--a.example");
    try {
      const exit = await Effect.runPromiseExit(
        Effect.tryPromise(() => initialize(database, "example.test"))
      );
      expect(String(exit)).not.toContain("xn--a.example");
      expect(
        database.prepare("select * from app_mail_domain").all()
      ).toStrictEqual([]);
    } finally {
      database.close();
    }
  });

  it("freezes the reserved pending lifecycle and reapply never heals", async () => {
    const database = await makeLegacyDatabase("example.test");
    try {
      await initialize(database, "example.test");
      expect(() =>
        database.exec(`update app_mail_domain set status = 'verified',
          updated_at = 1001, version = 2
          where id = 'legacy_default_v1_domain_v1'`)
      ).toThrow(/frozen/iu);
      database.exec("pragma foreign_keys = off");
      database.exec("drop trigger app_mail_domain_claim_receipt_no_delete");
      database.exec("delete from app_mail_domain_claim_receipt");
      database.exec("pragma foreign_keys = on");
      await expect(
        applyControlPlaneMigration(database, migration)
      ).rejects.toThrow(/constraint|valid/iu);
      expect(
        database.prepare("select * from app_mail_domain_claim_receipt").all()
      ).toStrictEqual([]);
    } finally {
      database.close();
    }
  });

  it.each([
    ["example.test", false],
    ["xn--bcher-kva.example", true],
  ] as const)(
    "materializes fresh %s with staged=%s",
    async (domain, staged) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        insertFreshBootstrap(database, domain, staged);
        await expect(initialize(database, domain)).resolves.toMatchObject({
          outcome: "validated",
        });
        expect(
          database.prepare("select * from app_mail_domain").get()
        ).toMatchObject({
          canonical_domain: domain,
          status: "pending_verification",
        });
      } finally {
        database.close();
      }
    }
  );

  it.each(["xn--bcher-kva.example", "xn--a.example"])(
    "rolls back a no-stage old-writer A-label: %s",
    async (domain) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        expect(() => insertFreshBootstrap(database, domain, false)).toThrow(
          /canonical/iu
        );
        expect(
          database.prepare("select * from app_mailbox").all()
        ).toStrictEqual([]);
        expect(
          database.prepare("select * from app_mail_domain").all()
        ).toStrictEqual([]);
      } finally {
        database.close();
      }
    }
  );

  it.each(["example.123", "ab--cd.example", `${"a".repeat(64)}.example`])(
    "rolls back an old-writer SQL-boundary domain: %s",
    async (domain) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        expect(() => insertFreshBootstrap(database, domain, false)).toThrow(
          /canonical|constraint|grammar/iu
        );
        expect(
          database.prepare("select * from app_mailbox").all()
        ).toStrictEqual([]);
        expect(
          database.prepare("select * from app_mail_domain").all()
        ).toStrictEqual([]);
      } finally {
        database.close();
      }
    }
  );

  it.each([
    [
      "app_organization_owner_assignment_from_bootstrap_audit",
      "app_mail_domain_claim_from_bootstrap_audit",
    ],
    [
      "app_mail_domain_claim_from_bootstrap_audit",
      "app_organization_owner_assignment_from_bootstrap_audit",
    ],
  ] as const)(
    "is independent of audit trigger creation order",
    async (first, second) => {
      const order = [first, second] as const;
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        const definitions = new Map(
          order.map((name) => [
            name,
            (
              database
                .prepare("select sql from sqlite_master where name = ?")
                .get(name) as { readonly sql: string }
            ).sql,
          ])
        );
        for (const name of order) {
          database.exec(`drop trigger "${name}"`);
        }
        for (const name of order) {
          database.exec(definitions.get(name) ?? "");
        }

        insertFreshBootstrap(database, "example.test", false);
        expect(
          database
            .prepare("select count(*) as count from app_mail_domain")
            .get()
        ).toMatchObject({ count: 1 });
        expect(
          database
            .prepare(
              "select count(*) as count from app_organization_owner_assignment_receipt"
            )
            .get()
        ).toMatchObject({ count: 1 });
      } finally {
        database.close();
      }
    }
  );

  it.each([
    "cutover",
    "bootstrap-intent",
    "bootstrap-audit",
    "owner-generation",
    "ancestry",
    "staged-v1",
  ] as const)(
    "blocks completed provenance corruption: %s",
    async (corruption) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        insertFreshBootstrap(database, "xn--bcher-kva.example", true);
        database.exec("pragma foreign_keys = off");
        if (corruption === "cutover") {
          database.exec(`drop trigger app_mail_domain_claim_cutover_no_update;
          update app_mail_domain_claim_cutover
             set initial_status = 'complete', initial_outcome = 'complete-pair'`);
        } else if (corruption === "bootstrap-intent") {
          database.exec(`drop trigger app_mailbox_bootstrap_domain_intent_no_delete;
          delete from app_mailbox_bootstrap_domain_intent`);
        } else if (corruption === "bootstrap-audit") {
          database.exec(`drop trigger app_administrative_audit_event_no_delete;
          delete from app_administrative_audit_event`);
        } else if (corruption === "owner-generation") {
          database.exec(`drop trigger app_organization_owner_assignment_receipt_no_delete;
          delete from app_organization_owner_assignment_receipt`);
        } else if (corruption === "ancestry") {
          database.exec(`drop trigger app_mailbox_legacy_organization_assignment_no_delete;
          delete from app_mailbox_legacy_organization_assignment`);
        } else {
          database.exec(`drop trigger app_mailbox_bootstrap_receipt_v2_no_delete;
          delete from app_mailbox_bootstrap_receipt_v2;
          insert into app_mailbox_bootstrap_receipt_v1_intent
            (operation_id, initial_address)
          values ('${operationId}', 'inbox@xn--bcher-kva.example')`);
        }
        database.exec("pragma foreign_keys = on");

        await expect(
          initialize(database, "xn--bcher-kva.example")
        ).rejects.toMatchObject({
          _tag: "LegacyMailDomainClaimInitializationError",
        });
      } finally {
        database.close();
      }
    }
  );

  it.each(["missing-cutover", "orphan-audit", "orphan-intent"] as const)(
    "blocks nonempty fresh history: %s",
    async (corruption) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        if (corruption === "missing-cutover") {
          database.exec(`drop trigger app_mail_domain_claim_cutover_no_delete;
            delete from app_mail_domain_claim_cutover`);
        } else if (corruption === "orphan-audit") {
          database.exec(`drop trigger app_organization_owner_assignment_from_bootstrap_audit;
            insert into app_administrative_audit_event
            (event_id, schema_version, event_version, operation_id, action,
             outcome, actor_type, actor_id, tenant_scope_type, tenant_scope_id,
             resource_type, resource_id, reason_code, change_type,
             resource_version_before, resource_version_after, occurred_at)
            values ('${auditEventId}', 1, 1, '${operationId}',
              'mailbox.owner-bootstrap', 'succeeded', 'user', 'user-a',
              'legacy-mailbox', 'primary', 'mailbox', 'primary',
              'owner-bootstrap', 'mailbox-bootstrapped', null, 1, 1000)`);
        } else {
          database.exec("pragma foreign_keys = off");
          database.exec(`drop trigger app_mailbox_bootstrap_domain_intent_binding;
            insert into app_mailbox_bootstrap_domain_intent
              (operation_id, canonical_domain, canonicalization_profile_id,
               canonicalization_version, schema_version)
            values ('${operationId}', 'example.test',
              'mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1',
              1, 1)`);
          database.exec("pragma foreign_keys = on");
        }
        await expect(
          initialize(database, "example.test")
        ).rejects.toMatchObject({
          _tag: "LegacyMailDomainClaimInitializationError",
        });
      } finally {
        database.close();
      }
    }
  );

  it("validates and deterministically reapplies an exact generation", async () => {
    const database = await makeLegacyDatabase("example.test");
    try {
      const manifestBefore = database
        .prepare("select * from app_mail_domain_claim_trigger_manifest")
        .get();
      await applyControlPlaneMigration(database, migration);
      expect(
        database
          .prepare("select * from app_mail_domain_claim_trigger_manifest")
          .get()
      ).toStrictEqual(manifestBefore);
    } finally {
      database.close();
    }
  });

  it.each(["missing", "no-op"] as const)(
    "rejects and does not heal a %s owned trigger",
    async (corruption) => {
      const database = await makeLegacyDatabase("example.test");
      try {
        database.exec("drop trigger app_mail_domain_claim_receipt_no_update");
        if (corruption === "no-op") {
          database.exec(`create trigger app_mail_domain_claim_receipt_no_update
            before update on app_mail_domain_claim_receipt begin select 1; end`);
        }
        const before = database
          .prepare(
            `select sql from sqlite_master
              where name = 'app_mail_domain_claim_receipt_no_update'`
          )
          .get();
        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/iu);
        expect(
          database
            .prepare(
              `select sql from sqlite_master
                where name = 'app_mail_domain_claim_receipt_no_update'`
            )
            .get()
        ).toStrictEqual(before);
      } finally {
        database.close();
      }
    }
  );

  it("rejects a reserved trigger collision before first-apply drop", async () => {
    const database = await makeLegacyDatabase("example.test", false);
    try {
      database.exec(`create trigger app_mail_domain_claim_receipt_no_update
        before update on app_mailbox begin select 1; end`);
      await expect(
        applyControlPlaneMigration(database, migration)
      ).rejects.toThrow(/constraint/iu);
      expect(
        database
          .prepare(
            `select tbl_name from sqlite_master
              where name = 'app_mail_domain_claim_receipt_no_update'`
          )
          .get()
      ).toMatchObject({ tbl_name: "app_mailbox" });
    } finally {
      database.close();
    }
  });

  it.each(["index-lookalike", "missing-trigger"] as const)(
    "rejects relied MailDomain generation corruption: %s",
    async (corruption) => {
      const database = await makeLegacyDatabase("example.test", false);
      try {
        if (corruption === "index-lookalike") {
          database.exec(`drop index app_mail_domain_current_canonical_idx;
            create unique index app_mail_domain_current_canonical_idx
              on app_mail_domain (canonical_domain)`);
        } else {
          database.exec("drop trigger app_mail_domain_insert_epoch_guard");
        }
        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/iu);
      } finally {
        database.close();
      }
    }
  );

  it.each(["receipt", "v1", "v2", "audit"] as const)(
    "rejects fresh-empty first application with orphan %s history",
    async (kind) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrationsThrough(
          database,
          "1025_app_organization_owner_assignment.sql"
        );
        insertOrphanBootstrapHistory(database, kind);
        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/iu);
      } finally {
        database.close();
      }
    }
  );

  it.each(["receipt", "v1", "v2", "audit", "domain-intent"] as const)(
    "rejects fresh-empty reapply with orphan %s history",
    async (kind) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        insertOrphanBootstrapHistory(database, kind);
        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/iu);
      } finally {
        database.close();
      }
    }
  );

  it.each(["table", "foreign-key", "index"] as const)(
    "rejects an own reserved %s lookalike before mutation",
    async (lookalike) => {
      const database = await makeLegacyDatabase("example.test", false);
      try {
        if (lookalike === "table") {
          database.exec(`create table app_mail_domain_claim_cutover (
            id integer primary key, schema_version integer not null)`);
        } else if (lookalike === "foreign-key") {
          database.exec(`create table app_mail_domain_claim_receipt (
            domain_id text primary key references app_organization(id))`);
        } else {
          database.exec(`create index app_mail_domain_claim_receipt_address_idx
            on app_mailbox (id)`);
        }
        const before = database
          .prepare(
            `select type, tbl_name, sql from sqlite_master
              where name = ?`
          )
          .get(
            lookalike === "table"
              ? "app_mail_domain_claim_cutover"
              : lookalike === "foreign-key"
                ? "app_mail_domain_claim_receipt"
                : "app_mail_domain_claim_receipt_address_idx"
          );
        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/iu);
        expect(
          database
            .prepare(
              `select type, tbl_name, sql from sqlite_master
                where name = ?`
            )
            .get(
              lookalike === "table"
                ? "app_mail_domain_claim_cutover"
                : lookalike === "foreign-key"
                  ? "app_mail_domain_claim_receipt"
                  : "app_mail_domain_claim_receipt_address_idx"
            )
        ).toStrictEqual(before);
      } finally {
        database.close();
      }
    }
  );
});
