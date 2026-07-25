import { DatabaseSync } from "node:sqlite";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import { MailboxRegistry } from "#/modules/mailbox/ports/MailboxRegistry";
import { MailboxRegistryD1Layer } from "#/modules/organization/adapters/d1/MailboxRegistryD1";
import {
  ControlPlaneD1Binding,
  ControlPlaneDatabaseLayer,
} from "#/platform/control-plane-d1/ControlPlaneDatabase";

import {
  applyControlPlaneMigrations,
  insertFreshCutoverOrganization,
  insertOrganizationLifecycleAudit,
  makeTestD1Database,
} from "../../../../support/d1";

const exists = (database: DatabaseSync) => {
  const binding = Layer.succeed(
    ControlPlaneD1Binding,
    ControlPlaneD1Binding.of({
      database: makeTestD1Database(database) as unknown as D1Database,
    })
  );
  return Effect.runPromise(
    MailboxRegistry.pipe(
      Effect.flatMap((registry) =>
        registry.exists(Schema.decodeUnknownSync(MailboxId)("primary"))
      ),
      Effect.provide(
        MailboxRegistryD1Layer.pipe(
          Layer.provide(ControlPlaneDatabaseLayer.pipe(Layer.provide(binding)))
        )
      )
    )
  );
};

describe("mailbox registry D1", () => {
  it("fails closed on committed null ancestry corruption", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertFreshCutoverOrganization(database, 1000);
      database.exec(`insert into app_mailbox
        (id, display_name, status, created_by_user_id, created_at, updated_at)
        values ('primary', 'Inbox', 'active', 'user-a', 1000, 1000)`);
      await expect(exists(database)).resolves.toBeTruthy();

      insertOrganizationLifecycleAudit(database, {
        action: "suspend",
        afterVersion: 2,
        beforeVersion: 1,
        occurredAt: 2000,
        organizationId: "legacy_default_v1",
      });
      database.exec(`
        update app_organization
           set status = 'suspended', updated_at = 2000, version = 2
         where id = 'legacy_default_v1';
      `);
      await expect(exists(database)).resolves.toBeFalsy();
      insertOrganizationLifecycleAudit(database, {
        action: "resume",
        afterVersion: 3,
        beforeVersion: 2,
        occurredAt: 3000,
        organizationId: "legacy_default_v1",
      });
      database.exec(`
        update app_organization
           set status = 'active', updated_at = 3000, version = 3
         where id = 'legacy_default_v1';
      `);
      await expect(exists(database)).resolves.toBeTruthy();

      database.exec(`
        drop trigger app_mailbox_organization_immutable;
        drop trigger app_mailbox_organization_consistent_after_update;
        update app_mailbox set organization_id = null where id = 'primary';
      `);
      await expect(exists(database)).resolves.toBeFalsy();
    } finally {
      database.close();
    }
  });
});
