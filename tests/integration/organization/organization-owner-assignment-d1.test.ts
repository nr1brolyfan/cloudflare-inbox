/* oxlint-disable vitest/max-expects -- Each case verifies one atomic security state. */
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
  applyControlPlaneMigration,
  applyControlPlaneMigrations,
  applyControlPlaneMigrationsThrough,
} from "../../support/d1";

const migration = "1025_app_organization_owner_assignment.sql";
const operationId = "00000000-0000-4000-8000-000000000010";
const auditEventId = `admin-audit-sha256:${"a".repeat(64)}`;
const renameOperationId = "00000000-0000-4000-8000-000000000020";

type History = "none" | "audit" | "receipt";

const makeLegacyDatabase = async (history: History = "none") => {
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
    values ('primary', 'primary', 'inbox@example.test', 'inbox@example.test',
            1, 1, 1000, 1000);
    insert into auth_role_grant
      (subject_type, subject_id, role_id, scope_type, scope_id_present,
       scope_id, expires_at, metadata, revoked_at)
    values ('user', 'user-a', 'owner', 'mailbox', 1, 'primary', null, null,
            null);
  `);
  if (history === "receipt") {
    database.exec(`insert into app_mailbox_administration_receipt
      (operation_id, operation_kind, actor_user_id, mailbox_id, display_name,
       expected_version, result_mailbox_id, result_display_name, result_status,
       result_created_by_user_id, result_created_at, result_updated_at,
       result_version, committed_at, schema_version)
    values ('${operationId}', 'bootstrap-owner', 'user-a', 'primary', 'Inbox',
      null, 'primary', 'Inbox', 'active', 'user-a', 1000, 1000, 1, 1000, 1)`);
  }
  if (history !== "none") {
    database.exec(`insert into app_administrative_audit_event
      (event_id, schema_version, event_version, operation_id, action, outcome,
       actor_type, actor_id, tenant_scope_type, tenant_scope_id, resource_type,
       resource_id, request_id, correlation_id, reason_code, change_type,
       resource_version_before, resource_version_after, occurred_at)
    values ('${auditEventId}', 1, 1, '${operationId}',
      'mailbox.owner-bootstrap', 'succeeded', 'user', 'user-a',
      'legacy-mailbox', 'primary', 'mailbox', 'primary', null, null,
      'owner-bootstrap', 'mailbox-bootstrapped', null, 1, 1000)`);
  }
  await applyControlPlaneMigration(
    database,
    "1023_app_organization_legacy_cutover.sql"
  );
  await applyControlPlaneMigration(
    database,
    "1024_app_mailbox_legacy_organization_assignment.sql"
  );
  return database;
};

const makeFresh1024Database = async () => {
  const database = new DatabaseSync(":memory:");
  await applyControlPlaneMigrationsThrough(
    database,
    "1024_app_mailbox_legacy_organization_assignment.sql"
  );
  return database;
};

const count = (database: DatabaseSync, table: string) =>
  (
    database.prepare(`select count(*) as count from "${table}"`).get() as {
      readonly count: number;
    }
  ).count;

const withoutTriggers = (
  database: DatabaseSync,
  names: readonly string[],
  mutation: () => void
) => {
  const triggers = names.map((name) => {
    const row = database
      .prepare(
        "select sql from sqlite_master where type = 'trigger' and name = ?"
      )
      .get(name) as { readonly sql: string } | undefined;
    if (row === undefined) {
      throw new Error(`Missing test trigger ${name}`);
    }
    return row.sql;
  });
  for (const name of names) {
    database.exec(`drop trigger "${name}"`);
  }
  mutation();
  for (const sql of triggers) {
    database.exec(sql);
  }
};

const insertUnrelatedRenameReceipt = (database: DatabaseSync) =>
  database.exec(`insert into app_mailbox_administration_receipt
    (operation_id, operation_kind, actor_user_id, mailbox_id, display_name,
     expected_version, result_mailbox_id, result_display_name, result_status,
     result_created_by_user_id, result_created_at, result_updated_at,
     result_version, committed_at, schema_version)
  values ('${renameOperationId}', 'rename', 'user-a', 'primary', 'Inbox', 1,
    'primary', 'Inbox', 'active', 'user-a', 1000, 1000, 1, 1000, 1)`);

const insertFreshBootstrapState = (
  database: DatabaseSync,
  beforeAudit?: () => void
) => {
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
    values ('primary', 'primary', 'inbox@example.test', 'inbox@example.test',
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
       expected_version, result_mailbox_id, result_display_name, result_status,
       result_created_by_user_id, result_created_at, result_updated_at,
       result_version, committed_at, schema_version)
    values ('${operationId}', 'bootstrap-owner', 'user-a', 'primary', 'Inbox',
      null, 'primary', 'Inbox', 'active', 'user-a', 1000, 1000, 1, 1000, 1);
  `);
  beforeAudit?.();
  database.exec(`insert into app_administrative_audit_event
    (event_id, schema_version, event_version, operation_id, action, outcome,
     actor_type, actor_id, tenant_scope_type, tenant_scope_id, resource_type,
     resource_id, request_id, correlation_id, reason_code, change_type,
     resource_version_before, resource_version_after, occurred_at)
  values ('${auditEventId}', 1, 1, '${operationId}',
    'mailbox.owner-bootstrap', 'succeeded', 'user', 'user-a',
    'legacy-mailbox', 'primary', 'mailbox', 'primary', null, null,
    'owner-bootstrap', 'mailbox-bootstrapped', null, 1, 1000)`);
};

describe("organization owner assignment migration", () => {
  it.each(["none", "audit", "receipt"] as const)(
    "assigns the unique grant nominee with %s legacy history",
    async (history) => {
      const database = await makeLegacyDatabase(history);
      try {
        await applyControlPlaneMigration(database, migration);
        const receipt = database
          .prepare("select * from app_organization_owner_assignment_receipt")
          .get() as Record<string, unknown>;

        expect(receipt).toMatchObject({
          legacy_role_id: "owner",
          legacy_scope_id: "primary",
          legacy_subject_id: "user-a",
          mailbox_id: "primary",
          membership_id: "legacy_default_v1_owner_v1",
          organization_id: "legacy_default_v1",
          organization_role_id: "organization.owner",
          organization_scope_id: "legacy_default_v1",
          schema_version: 1,
          source: "legacy-cutover",
          source_audit_event_id: history === "none" ? null : auditEventId,
          source_bootstrap_operation_id:
            history === "receipt" ? operationId : null,
          user_id: "user-a",
        });
        expect(receipt.assigned_at).toStrictEqual(expect.any(Number));
        expect(receipt.assigned_at).toBeGreaterThanOrEqual(1000);
        expect(
          database.prepare("select * from app_organization_member").get()
        ).toMatchObject({
          created_at: receipt.assigned_at,
          id: "legacy_default_v1_owner_v1",
          organization_id: "legacy_default_v1",
          status: "active",
          updated_at: receipt.assigned_at,
          user_id: "user-a",
          version: 1,
        });
        expect(
          database
            .prepare(
              `select * from auth_role_grant
               where role_id = 'organization.owner'`
            )
            .get()
        ).toMatchObject({
          expires_at: null,
          metadata:
            '{"membershipId":"legacy_default_v1_owner_v1","source":"organization-owner-bootstrap-v1"}',
          revoked_at: null,
          scope_id: "legacy_default_v1",
          scope_id_present: 1,
          scope_type: "organization",
          subject_id: "user-a",
          subject_type: "user",
        });
        expect(
          database.prepare("pragma foreign_key_check").all()
        ).toStrictEqual([]);
      } finally {
        database.close();
      }
    }
  );

  it("accepts audit-only legacy history with an unrelated rename receipt", async () => {
    const database = await makeLegacyDatabase("audit");
    try {
      insertUnrelatedRenameReceipt(database);
      await applyControlPlaneMigration(database, migration);
      expect({
        ...database
          .prepare(
            "select source_bootstrap_operation_id, source_audit_event_id from app_organization_owner_assignment_receipt"
          )
          .get(),
      }).toStrictEqual({
        source_audit_event_id: auditEventId,
        source_bootstrap_operation_id: null,
      });
    } finally {
      database.close();
    }
  });

  it.each([
    "fixed-membership",
    "unrelated-membership",
    "target-grant-wrong-metadata",
    "target-grant-wrong-subject",
    "target-grant-wrong-scope-shape",
    "poisoned-receipt",
  ] as const)(
    "rejects fresh preexisting target authority: %s",
    async (state) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        expect(() =>
          insertFreshBootstrapState(database, () => {
            if (state === "fixed-membership") {
              database.exec(`insert into app_organization_member
              (id, organization_id, user_id, created_at, updated_at)
              values ('legacy_default_v1_owner_v1', 'legacy_default_v1',
                'user-a', 1000, 1000)`);
            } else if (state === "unrelated-membership") {
              database.exec(`insert into app_organization_member
              (id, organization_id, user_id, created_at, updated_at)
              values ('unrelated', 'legacy_default_v1', 'user-a', 1000, 1000)`);
            } else if (state.startsWith("target-grant")) {
              if (state === "target-grant-wrong-subject") {
                database.exec(`insert into auth_user (id, created_at, updated_at)
                values ('user-b', 1000, 1000)`);
              }
              database
                .prepare(
                  `insert into auth_role_grant
                  (subject_type, subject_id, role_id, scope_type,
                   scope_id_present, scope_id, metadata)
                 values ('user', ?, 'organization.owner', ?, ?,
                   'legacy_default_v1', ?)`
                )
                .run(
                  state === "target-grant-wrong-subject" ? "user-b" : "user-a",
                  state === "target-grant-wrong-scope-shape"
                    ? "mailbox"
                    : "organization",
                  state === "target-grant-wrong-scope-shape" ? 0 : 1,
                  state === "target-grant-wrong-metadata"
                    ? '{"wrong":true}'
                    : '{"membershipId":"legacy_default_v1_owner_v1","source":"organization-owner-bootstrap-v1"}'
                );
            } else {
              database.exec(`
              drop trigger app_organization_owner_assignment_receipt_binding;
              pragma foreign_keys = off;
              insert into app_organization_owner_assignment_receipt
                (organization_id, mailbox_id, user_id, membership_id,
                 assigned_at, source, legacy_subject_type, legacy_subject_id,
                 legacy_role_id, legacy_scope_type, legacy_scope_id_present,
                 legacy_scope_id, organization_subject_type,
                 organization_subject_id, organization_role_id,
                 organization_scope_type, organization_scope_id_present,
                 organization_scope_id, source_bootstrap_operation_id,
                 source_audit_event_id, schema_version)
              values ('legacy_default_v1', 'primary', 'user-a',
                'legacy_default_v1_owner_v1', 1000, 'legacy-cutover', 'user',
                'user-a', 'owner', 'mailbox', 1, 'primary', 'user', 'user-a',
                'organization.owner', 'organization', 1,
                'legacy_default_v1', null, null, 1);
              pragma foreign_keys = on;
            `);
            }
          })
        ).toThrow(/escalation|constraint|invalid/u);
        expect(count(database, "app_administrative_audit_event")).toBe(0);
        expect(
          count(database, "app_organization_owner_assignment_receipt")
        ).toBe(state === "poisoned-receipt" ? 1 : 0);
      } finally {
        database.close();
      }
    }
  );

  it.each([
    "legacy-missing",
    "legacy-extra",
    "legacy-permission-disabled",
    "target-missing",
    "target-extra",
    "target-disabled",
    "target-permission-disabled",
  ] as const)(
    "rejects catalog drift during fresh materialization: %s",
    async (state) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        if (state === "legacy-missing") {
          database.exec(`delete from auth_role_permission
          where role_id = 'owner' and permission_id = 'mailbox.read'`);
        } else if (state === "legacy-extra") {
          database.exec(`insert into auth_role_permission
          (role_id, permission_id, scope_type_present, scope_type)
          values ('owner', 'organization.read', 1, 'organization')`);
        } else if (state === "legacy-permission-disabled") {
          database.exec(`
          drop trigger app_canonical_permission_definition_no_update;
          update auth_permission_definition set disabled_at = 1
           where id = 'mailbox.read';
        `);
        } else if (state === "target-missing") {
          database.exec(`
          drop trigger app_canonical_role_permission_no_delete;
          delete from auth_role_permission where role_id = 'organization.owner'
            and permission_id = 'organization.read';
        `);
        } else if (state === "target-extra") {
          database.exec(`
          drop trigger app_canonical_role_permission_insert_contract;
          insert into auth_role_permission
            (role_id, permission_id, scope_type_present, scope_type)
          values ('organization.owner', 'mailbox.read', 1, 'mailbox');
        `);
        } else if (state === "target-disabled") {
          database.exec(`
          drop trigger app_canonical_role_definition_no_update;
          update auth_role_definition set disabled_at = 1
           where id = 'organization.owner';
        `);
        } else {
          database.exec(`
          drop trigger app_canonical_permission_definition_no_update;
          update auth_permission_definition set disabled_at = 1
           where id = 'organization.read';
        `);
        }

        expect(() => insertFreshBootstrapState(database)).toThrow(
          /nomination|materialization|constraint/u
        );
        expect(count(database, "app_administrative_audit_event")).toBe(0);
        expect(
          count(database, "app_organization_owner_assignment_receipt")
        ).toBe(0);
        expect(count(database, "app_organization_member")).toBe(0);
        expect(
          database
            .prepare(
              "select count(*) as count from auth_role_grant where role_id = 'organization.owner'"
            )
            .get()
        ).toMatchObject({ count: 0 });
      } finally {
        database.close();
      }
    }
  );

  it("seals only the cutover for a fresh empty deployment", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      expect(count(database, "app_organization_owner_assignment_cutover")).toBe(
        1
      );
      expect(count(database, "app_organization_owner_assignment_receipt")).toBe(
        0
      );
      expect(count(database, "app_organization_member")).toBe(0);
    } finally {
      database.close();
    }
  });

  it("allows pre-bootstrap auth users while classifying fresh-empty", async () => {
    const database = await makeFresh1024Database();
    try {
      database.exec(`insert into auth_user (id, created_at, updated_at)
        values ('preexisting-user', 1, 1)`);
      await applyControlPlaneMigration(database, migration);
      expect(count(database, "app_organization_owner_assignment_cutover")).toBe(
        1
      );
      expect(count(database, "app_organization_owner_assignment_receipt")).toBe(
        0
      );
    } finally {
      database.close();
    }
  });

  it.each([
    "primary-owner-grant",
    "global-owner-grant",
    "mailbox-member",
    "bootstrap-receipt",
    "bootstrap-intent",
    "bootstrap-audit",
    "organization-member",
    "organization-owner-grant",
    "organization-owner-receipt",
    "ancestry",
  ] as const)(
    "rejects post-cutover fresh-empty stale state: %s",
    async (state) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        if (state === "primary-owner-grant" || state === "global-owner-grant") {
          database
            .prepare(
              `insert into auth_role_grant
              (subject_type, subject_id, role_id, scope_type,
               scope_id_present, scope_id)
             values ('user', 'stale-user', 'owner', ?, ?, ?)`
            )
            .run(
              state === "global-owner-grant" ? "global" : "mailbox",
              state === "global-owner-grant" ? 0 : 1,
              state === "global-owner-grant" ? "" : "primary"
            );
        } else if (state === "mailbox-member") {
          database.exec(`
          pragma foreign_keys = off;
          insert into app_mailbox_member
            (mailbox_id, user_id, created_at, updated_at)
          values ('primary', 'stale-user', 1, 1);
          pragma foreign_keys = on;
        `);
        } else if (
          state === "bootstrap-receipt" ||
          state === "bootstrap-intent"
        ) {
          withoutTriggers(
            database,
            [
              "app_mailbox_administration_receipt_binding",
              "app_mailbox_bootstrap_receipt_v1_intent_from_parent",
            ],
            () =>
              database.exec(`insert into app_mailbox_administration_receipt
              (operation_id, operation_kind, actor_user_id, mailbox_id,
               display_name, expected_version, result_mailbox_id,
               result_display_name, result_status, result_created_by_user_id,
               result_created_at, result_updated_at, result_version,
               committed_at, schema_version)
              values ('${operationId}', 'bootstrap-owner', 'stale-user',
                'primary', 'Inbox', null, 'primary', 'Inbox', 'active',
                'stale-user', 1, 1, 1, 1, 1)`)
          );
          if (state === "bootstrap-intent") {
            withoutTriggers(
              database,
              ["app_mailbox_bootstrap_receipt_v1_intent_binding"],
              () =>
                database.exec(`insert into app_mailbox_bootstrap_receipt_v1_intent
                (operation_id, initial_address)
                values ('${operationId}', 'inbox@example.test')`)
            );
          }
        } else if (state === "bootstrap-audit") {
          withoutTriggers(
            database,
            ["app_organization_owner_assignment_from_bootstrap_audit"],
            () =>
              database.exec(`insert into app_administrative_audit_event
              (event_id, schema_version, event_version, operation_id, action,
               outcome, actor_type, actor_id, tenant_scope_type,
               tenant_scope_id, resource_type, resource_id, reason_code,
               change_type, resource_version_before, resource_version_after,
               occurred_at)
              values ('${auditEventId}', 1, 1, '${operationId}',
                'mailbox.owner-bootstrap', 'succeeded', 'user', 'stale-user',
                'legacy-mailbox', 'primary', 'mailbox', 'primary',
                'owner-bootstrap', 'mailbox-bootstrapped', null, 1, 1)`)
          );
        } else if (state === "organization-member") {
          database.exec(`
          pragma foreign_keys = off;
          insert into app_organization_member
            (id, organization_id, user_id, created_at, updated_at)
          values ('legacy_default_v1_owner_v1', 'legacy_default_v1',
            'stale-user', 1, 1);
          pragma foreign_keys = on;
        `);
        } else if (state === "organization-owner-grant") {
          database.exec(`insert into auth_role_grant
          (subject_type, subject_id, role_id, scope_type, scope_id_present,
           scope_id)
          values ('user', 'stale-user', 'organization.owner', 'organization',
            1, 'legacy_default_v1')`);
        } else if (state === "organization-owner-receipt") {
          withoutTriggers(
            database,
            ["app_organization_owner_assignment_receipt_binding"],
            () =>
              database.exec(`
              pragma foreign_keys = off;
              insert into app_organization_owner_assignment_receipt
                (organization_id, mailbox_id, user_id, membership_id,
                 assigned_at, source, legacy_subject_type, legacy_subject_id,
                 legacy_role_id, legacy_scope_type, legacy_scope_id_present,
                 legacy_scope_id, organization_subject_type,
                 organization_subject_id, organization_role_id,
                 organization_scope_type, organization_scope_id_present,
                 organization_scope_id, source_bootstrap_operation_id,
                 source_audit_event_id, schema_version)
              values ('legacy_default_v1', 'primary', 'stale-user',
                'legacy_default_v1_owner_v1', 1, 'legacy-cutover', 'user',
                'stale-user', 'owner', 'mailbox', 1, 'primary', 'user',
                'stale-user', 'organization.owner', 'organization', 1,
                'legacy_default_v1', null, null, 1);
              pragma foreign_keys = on;
            `)
          );
        } else {
          withoutTriggers(
            database,
            ["app_mailbox_legacy_organization_assignment_binding"],
            () =>
              database.exec(`
              pragma foreign_keys = off;
              insert into app_mailbox_legacy_organization_assignment
                (mailbox_id, organization_id, effective_at, source,
                 schema_version)
              values ('primary', 'legacy_default_v1', 1, 'fresh-bootstrap', 1);
              pragma foreign_keys = on;
            `)
          );
        }

        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/u);
        expect(
          count(database, "app_organization_owner_assignment_cutover")
        ).toBe(1);
        expect(count(database, "app_organization")).toBe(0);
        expect(count(database, "app_mailbox")).toBe(0);
      } finally {
        database.close();
      }
    }
  );

  it.each([
    [null, null],
    [operationId, null],
    [null, auditEventId],
  ] as const)(
    "rejects a direct fresh receipt with incomplete provenance",
    async (sourceOperationId, sourceEventId) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        expect(() =>
          database
            .prepare(
              `insert into app_organization_owner_assignment_receipt
                (organization_id, mailbox_id, user_id, membership_id,
                 assigned_at, source, legacy_subject_type, legacy_subject_id,
                 legacy_role_id, legacy_scope_type, legacy_scope_id_present,
                 legacy_scope_id, organization_subject_type,
                 organization_subject_id, organization_role_id,
                 organization_scope_type, organization_scope_id_present,
                 organization_scope_id, source_bootstrap_operation_id,
                 source_audit_event_id, schema_version)
               values ('legacy_default_v1', 'primary', 'user-a',
                 'legacy_default_v1_owner_v1', 1000, 'fresh-bootstrap',
                 'user', 'user-a', 'owner', 'mailbox', 1, 'primary', 'user',
                 'user-a', 'organization.owner', 'organization', 1,
                 'legacy_default_v1', ?, ?, 1)`
            )
            .run(sourceOperationId, sourceEventId)
        ).toThrow(
          /invalid organization owner assignment receipt|check constraint/u
        );
        expect(
          count(database, "app_organization_owner_assignment_receipt")
        ).toBe(0);
      } finally {
        database.close();
      }
    }
  );

  it.each([
    "legacy-owner-grant",
    "mailbox-member",
    "bootstrap-receipt",
    "bootstrap-intent",
    "bootstrap-audit",
  ] as const)(
    "rejects stale fresh-empty authority/history: %s",
    async (state) => {
      const database = await makeFresh1024Database();
      try {
        if (state === "legacy-owner-grant") {
          database.exec(`insert into auth_role_grant
          (subject_type, subject_id, role_id, scope_type, scope_id_present,
           scope_id)
          values ('user', 'stale-user', 'owner', 'mailbox', 1, 'primary')`);
        } else if (state === "mailbox-member") {
          database.exec(`
          pragma foreign_keys = off;
          insert into app_mailbox_member
            (mailbox_id, user_id, created_at, updated_at)
          values ('primary', 'stale-user', 1, 1);
          pragma foreign_keys = on;
        `);
        } else if (state === "bootstrap-audit") {
          database.exec(`insert into app_administrative_audit_event
          (event_id, schema_version, event_version, operation_id, action,
           outcome, actor_type, actor_id, tenant_scope_type, tenant_scope_id,
           resource_type, resource_id, reason_code, change_type,
           resource_version_before, resource_version_after, occurred_at)
          values ('${auditEventId}', 1, 1, '${operationId}',
            'mailbox.owner-bootstrap', 'succeeded', 'user', 'stale-user',
            'legacy-mailbox', 'primary', 'mailbox', 'primary',
            'owner-bootstrap', 'mailbox-bootstrapped', null, 1, 1)`);
        } else {
          database.exec(`
          drop trigger app_mailbox_administration_receipt_binding;
          drop trigger app_mailbox_bootstrap_receipt_v1_intent_from_parent;
          insert into app_mailbox_administration_receipt
            (operation_id, operation_kind, actor_user_id, mailbox_id,
             display_name, expected_version, result_mailbox_id,
             result_display_name, result_status, result_created_by_user_id,
             result_created_at, result_updated_at, result_version,
             committed_at, schema_version)
          values ('${operationId}', 'bootstrap-owner', 'stale-user', 'primary',
            'Inbox', null, 'primary', 'Inbox', 'active', 'stale-user', 1, 1,
            1, 1, 1);
        `);
          if (state === "bootstrap-intent") {
            database.exec(`
            drop trigger app_mailbox_bootstrap_receipt_v1_intent_binding;
            insert into app_mailbox_bootstrap_receipt_v1_intent
            (operation_id, initial_address)
            values ('${operationId}', 'inbox@example.test')`);
          }
        }

        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/u);
        expect(
          database
            .prepare(
              `select count(*) as count from sqlite_master
             where name like 'app_organization_owner_assignment_%'`
            )
            .get()
        ).toMatchObject({ count: 0 });
      } finally {
        database.close();
      }
    }
  );

  it.each([
    "legacy-missing",
    "legacy-extra",
    "legacy-remapped",
    "legacy-disabled",
    "legacy-permission-disabled",
    "target-missing",
    "target-extra",
    "target-remapped",
    "target-disabled",
    "target-permission-disabled",
  ] as const)(
    "rejects catalog drift on first application: %s",
    async (state) => {
      const database = await makeLegacyDatabase();
      try {
        if (state === "legacy-missing") {
          database.exec(`delete from auth_role_permission
          where role_id = 'owner' and permission_id = 'mailbox.read'`);
        } else if (state === "legacy-extra") {
          database.exec(`insert into auth_role_permission
          (role_id, permission_id, scope_type_present, scope_type)
          values ('owner', 'organization.read', 1, 'organization')`);
        } else if (state === "legacy-remapped") {
          database.exec(`update auth_role_permission set scope_type = 'folder'
          where role_id = 'owner' and permission_id = 'mailbox.read'`);
        } else if (state === "legacy-disabled") {
          database.exec(
            "update auth_role_definition set disabled_at = 1 where id = 'owner'"
          );
        } else if (state === "legacy-permission-disabled") {
          database.exec(`
          drop trigger app_canonical_permission_definition_no_update;
          update auth_permission_definition set disabled_at = 1
           where id = 'mailbox.read';
        `);
        } else if (state === "target-missing") {
          database.exec(`
          drop trigger app_canonical_role_permission_no_delete;
          delete from auth_role_permission where role_id = 'organization.owner'
            and permission_id = 'organization.read';
        `);
        } else if (state === "target-extra") {
          database.exec(`
          drop trigger app_canonical_role_permission_insert_contract;
          insert into auth_role_permission
            (role_id, permission_id, scope_type_present, scope_type)
          values ('organization.owner', 'mailbox.read', 1, 'mailbox');
        `);
        } else if (state === "target-remapped") {
          database.exec(`
          drop trigger app_canonical_role_permission_no_update;
          update auth_role_permission set scope_type = 'mailbox'
           where role_id = 'organization.owner'
             and permission_id = 'organization.read';
        `);
        } else if (state === "target-disabled") {
          database.exec(`
          drop trigger app_canonical_role_definition_no_update;
          update auth_role_definition set disabled_at = 1
           where id = 'organization.owner';
        `);
        } else {
          database.exec(`
          drop trigger app_canonical_permission_definition_no_update;
          update auth_permission_definition set disabled_at = 1
           where id = 'organization.read';
        `);
        }
        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/u);
      } finally {
        database.close();
      }
    }
  );

  it.each([
    "zero-candidate",
    "two-candidates",
    "revoked",
    "expiring",
    "metadata",
    "global",
    "disabled-user",
    "revoked-mailbox-member",
    "creator-mismatch",
    "membership-collision",
    "grant-collision",
  ] as const)("atomically rejects %s", async (state) => {
    const database = await makeLegacyDatabase();
    try {
      if (state === "zero-candidate") {
        database.prepare("delete from auth_role_grant").run();
      } else if (state === "two-candidates") {
        database.exec(`
          insert into auth_user (id, created_at, updated_at)
          values ('user-b', 1000, 1000);
          insert into auth_role_grant
            (subject_type, subject_id, role_id, scope_type, scope_id_present,
             scope_id)
          values ('user', 'user-b', 'owner', 'mailbox', 1, 'primary')`);
      } else if (state === "revoked") {
        database.prepare("update auth_role_grant set revoked_at = 1100").run();
      } else if (state === "expiring") {
        database
          .prepare("update auth_role_grant set expires_at = 999999")
          .run();
      } else if (state === "metadata") {
        database.prepare("update auth_role_grant set metadata = '{}'").run();
      } else if (state === "global") {
        database.exec(`insert into auth_role_grant
          (subject_type, subject_id, role_id, scope_type, scope_id_present,
           scope_id)
          values ('user', 'user-a', 'owner', 'global', 0, '')`);
      } else if (state === "disabled-user") {
        database.prepare("update auth_user set disabled_at = 1100").run();
      } else if (state === "revoked-mailbox-member") {
        database
          .prepare(
            "update app_mailbox_member set revoked_at = 1100, updated_at = 1100"
          )
          .run();
      } else if (state === "creator-mismatch") {
        database
          .prepare("update app_mailbox set created_by_user_id = 'user-b'")
          .run();
      } else if (state === "membership-collision") {
        database.exec(`insert into app_organization_member
          (id, organization_id, user_id, created_at, updated_at)
          values ('collision', 'legacy_default_v1', 'user-a', 1000, 1000)`);
      } else {
        database.exec(`insert into auth_role_grant
          (subject_type, subject_id, role_id, scope_type, scope_id_present,
           scope_id, metadata)
          values ('user', 'user-a', 'organization.owner', 'organization', 1,
            'legacy_default_v1', '{"wrong":true}')`);
      }

      await expect(
        applyControlPlaneMigration(database, migration)
      ).rejects.toThrow(/constraint/u);
      expect(
        database
          .prepare(
            `select count(*) as count from sqlite_master
             where type = 'table'
               and name like 'app_organization_owner_assignment_%'`
          )
          .get()
      ).toMatchObject({ count: 0 });
      expect(count(database, "app_organization_member")).toBe(
        state === "membership-collision" ? 1 : 0
      );
    } finally {
      database.close();
    }
  });

  it("reapplies after legal membership suspension and grant revocation", async () => {
    const database = await makeLegacyDatabase();
    try {
      await applyControlPlaneMigration(database, migration);
      const receiptBefore = {
        ...database
          .prepare("select * from app_organization_owner_assignment_receipt")
          .get(),
      };
      const lifecycleAt = Number(receiptBefore.assigned_at) + 1;
      database
        .prepare(
          `update app_organization_member
              set status = 'suspended', suspended_at = ?, updated_at = ?,
                  version = 2
            where id = 'legacy_default_v1_owner_v1'`
        )
        .run(lifecycleAt, lifecycleAt);
      database
        .prepare(
          `update auth_role_grant set revoked_at = ?
            where role_id = 'organization.owner'`
        )
        .run(lifecycleAt);

      await applyControlPlaneMigration(database, migration);

      expect({
        ...database
          .prepare("select * from app_organization_owner_assignment_receipt")
          .get(),
      }).toStrictEqual(receiptBefore);
      expect(
        database
          .prepare(
            "select status, version from app_organization_member where id = 'legacy_default_v1_owner_v1'"
          )
          .get()
      ).toMatchObject({ status: "suspended", version: 2 });
      expect(
        database
          .prepare(
            "select revoked_at from auth_role_grant where role_id = 'organization.owner'"
          )
          .get()
      ).toMatchObject({ revoked_at: lifecycleAt });
    } finally {
      database.close();
    }
  });

  it("never heals a missing retained receipt", async () => {
    const database = await makeLegacyDatabase();
    try {
      await applyControlPlaneMigration(database, migration);
      database.exec(`
        drop trigger app_organization_owner_assignment_receipt_no_delete;
        delete from app_organization_owner_assignment_receipt;
      `);
      await expect(
        applyControlPlaneMigration(database, migration)
      ).rejects.toThrow(/constraint/u);
      expect(count(database, "app_organization_owner_assignment_receipt")).toBe(
        0
      );
    } finally {
      database.close();
    }
  });

  it.each(["membership", "organization-grant"] as const)(
    "never heals a missing retained %s",
    async (artifact) => {
      const database = await makeLegacyDatabase();
      try {
        await applyControlPlaneMigration(database, migration);
        database.exec("pragma foreign_keys = off");
        if (artifact === "membership") {
          database.exec(`
            drop trigger app_organization_member_no_delete;
            delete from app_organization_member
             where id = 'legacy_default_v1_owner_v1';
          `);
        } else {
          database.exec(`delete from auth_role_grant
            where role_id = 'organization.owner'
              and scope_id = 'legacy_default_v1'`);
        }
        database.exec("pragma foreign_keys = on");

        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/u);
        expect(
          count(
            database,
            artifact === "membership"
              ? "app_organization_member"
              : "auth_role_grant"
          )
        ).toBe(artifact === "membership" ? 0 : 1);
      } finally {
        database.close();
      }
    }
  );

  it.each([
    "missing",
    "changed-source",
    "changed-effective-at",
    "additional",
  ] as const)(
    "rejects completed-state ORG-007 ancestry corruption: %s",
    async (state) => {
      const database = await makeLegacyDatabase();
      try {
        await applyControlPlaneMigration(database, migration);
        if (state === "missing") {
          withoutTriggers(
            database,
            ["app_mailbox_legacy_organization_assignment_no_delete"],
            () =>
              database.exec(
                "delete from app_mailbox_legacy_organization_assignment"
              )
          );
        } else if (state === "additional") {
          withoutTriggers(
            database,
            ["app_mailbox_legacy_organization_assignment_binding"],
            () =>
              database.exec(`
              pragma foreign_keys = off;
              pragma ignore_check_constraints = on;
              insert into app_mailbox_legacy_organization_assignment
                (mailbox_id, organization_id, effective_at, source,
                 schema_version)
              values ('secondary', 'legacy_default_v1', 1000,
                'legacy-cutover', 1);
              pragma ignore_check_constraints = off;
              pragma foreign_keys = on;
            `)
          );
        } else {
          withoutTriggers(
            database,
            ["app_mailbox_legacy_organization_assignment_no_update"],
            () =>
              database.exec(
                state === "changed-source"
                  ? `update app_mailbox_legacy_organization_assignment
                      set source = 'fresh-bootstrap'`
                  : `update app_mailbox_legacy_organization_assignment
                      set effective_at = effective_at + 1`
              )
          );
        }

        const corrupted = database
          .prepare(
            `select mailbox_id, organization_id, effective_at, source,
                  schema_version
             from app_mailbox_legacy_organization_assignment
            order by mailbox_id`
          )
          .all()
          .map((row) => ({ ...row }));
        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/u);
        expect(
          database
            .prepare(
              `select mailbox_id, organization_id, effective_at, source,
                    schema_version
               from app_mailbox_legacy_organization_assignment
              order by mailbox_id`
            )
            .all()
            .map((row) => ({ ...row }))
        ).toStrictEqual(corrupted);
        expect(
          count(database, "app_organization_owner_assignment_receipt")
        ).toBe(1);
      } finally {
        database.close();
      }
    }
  );

  it("repairs a correct-target owned trigger only on valid reapply", async () => {
    const database = await makeLegacyDatabase();
    try {
      await applyControlPlaneMigration(database, migration);
      database.exec(`
        drop trigger app_organization_owner_assignment_receipt_no_update;
        create trigger app_organization_owner_assignment_receipt_no_update
        before update on app_organization_owner_assignment_receipt
        begin
          select raise(abort, 'lookalike');
        end;
      `);

      await applyControlPlaneMigration(database, migration);
      expect(
        database
          .prepare(
            `select sql from sqlite_master
             where name = 'app_organization_owner_assignment_receipt_no_update'`
          )
          .get()
      ).toMatchObject({
        sql: expect.stringContaining(
          "organization owner assignment receipts are immutable"
        ),
      });
    } finally {
      database.close();
    }
  });

  it.each([
    {
      name: "own receipt DDL",
      replacement: "source = 'FRESH-bootstrap'",
      target: "source = 'fresh-bootstrap'",
      type: "table",
      artifact: "app_organization_owner_assignment_receipt",
      reapply: true,
    },
    {
      name: "own receipt FK action",
      replacement: "on update cascade on delete restrict",
      target: "on update restrict on delete restrict",
      type: "table",
      artifact: "app_organization_owner_assignment_receipt",
      reapply: true,
    },
    {
      name: "ORG-007 ancestry DDL",
      replacement: "mailbox_id = 'PRIMARY'",
      target: "mailbox_id = 'primary'",
      type: "table",
      artifact: "app_mailbox_legacy_organization_assignment",
      reapply: false,
    },
    {
      name: "ORG-006 cutover DDL",
      replacement: "outcome = 'LEGACY-primary'",
      target: "outcome = 'legacy-primary'",
      type: "table",
      artifact: "app_organization_legacy_cutover",
      reapply: false,
    },
    {
      name: "parent singleton index",
      replacement: "on app_mailbox ((01))",
      target: "on app_mailbox ((1))",
      type: "index",
      artifact: "app_mailbox_singleton_idx",
      reapply: false,
    },
  ] as const)("rejects byte-changed $name", async (variant) => {
    const database = await makeLegacyDatabase();
    try {
      if (variant.reapply) {
        await applyControlPlaneMigration(database, migration);
      }
      database.exec("pragma writable_schema = on");
      database
        .prepare(
          `update sqlite_master set sql = replace(sql, ?, ?)
            where type = ? and name = ?`
        )
        .run(
          variant.target,
          variant.replacement,
          variant.type,
          variant.artifact
        );
      database.exec("pragma writable_schema = off");

      await expect(
        applyControlPlaneMigration(database, migration)
      ).rejects.toThrow(/constraint/u);
      expect(
        database
          .prepare("select sql from sqlite_master where name = ?")
          .get(variant.artifact)
      ).toMatchObject({ sql: expect.stringContaining(variant.replacement) });
    } finally {
      database.close();
    }
  });

  it("rejects an extra owned receipt index", async () => {
    const database = await makeLegacyDatabase();
    try {
      await applyControlPlaneMigration(database, migration);
      database.exec(`create index app_organization_owner_assignment_extra_idx
        on app_organization_owner_assignment_receipt (user_id)`);
      await expect(
        applyControlPlaneMigration(database, migration)
      ).rejects.toThrow(/constraint/u);
      expect(
        database
          .prepare(
            "select type from sqlite_master where name = 'app_organization_owner_assignment_extra_idx'"
          )
          .get()
      ).toMatchObject({ type: "index" });
    } finally {
      database.close();
    }
  });

  it.each([
    "app_mailbox_legacy_organization_assignment_no_update",
    "app_mailbox_legacy_organization_assignment_from_fresh_mailbox",
    "app_organization_fresh_mailbox_insert_guard",
    "app_canonical_role_permission_insert_contract",
    "app_canonical_role_permission_no_update",
  ] as const)(
    "rejects a security-critical parent trigger lookalike: %s",
    async (name) => {
      const database = await makeLegacyDatabase();
      try {
        const table = (
          database
            .prepare("select tbl_name from sqlite_master where name = ?")
            .get(name) as { readonly tbl_name: string }
        ).tbl_name;
        database.exec(`drop trigger "${name}"`);
        database.exec(`create trigger "${name}" before update on "${table}"
        begin select raise(abort, 'lookalike'); end`);

        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/u);
        expect(
          database
            .prepare("select sql from sqlite_master where name = ?")
            .get(name)
        ).toMatchObject({ sql: expect.stringContaining("lookalike") });
      } finally {
        database.close();
      }
    }
  );

  it("leaves an unrelated reserved trigger-name collision untouched", async () => {
    const database = await makeFresh1024Database();
    try {
      database.exec(`create table app_organization_owner_assignment_receipt_binding
        (value text)`);
      await expect(
        applyControlPlaneMigration(database, migration)
      ).rejects.toThrow(/constraint/u);
      expect({
        ...database
          .prepare(
            "select type from sqlite_master where name = 'app_organization_owner_assignment_receipt_binding'"
          )
          .get(),
      }).toStrictEqual({ type: "table" });
    } finally {
      database.close();
    }
  });
});
