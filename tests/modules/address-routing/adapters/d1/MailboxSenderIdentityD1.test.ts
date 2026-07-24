import { DatabaseSync } from "node:sqlite";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { MailboxSenderIdentityD1Layer } from "#/modules/address-routing/adapters/d1/MailboxSenderIdentityD1";
import { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import { MailboxSenderIdentity } from "#/modules/mailbox/ports/MailboxSenderIdentity";
import {
  ControlPlaneD1Binding,
  ControlPlaneDatabaseLayer,
} from "#/platform/control-plane-d1/ControlPlaneDatabase";

import {
  applyControlPlaneMigrations,
  insertFreshCutoverOrganization,
  makeTestD1Database,
} from "../../../../support/d1";

const senderIdentityLive = (database: DatabaseSync) => {
  const bindingLive = Layer.succeed(
    ControlPlaneD1Binding,
    ControlPlaneD1Binding.of({
      database: makeTestD1Database(database) as unknown as D1Database,
    })
  );
  const databaseLive = ControlPlaneDatabaseLayer.pipe(
    Layer.provide(bindingLive)
  );

  return MailboxSenderIdentityD1Layer.pipe(Layer.provide(databaseLive));
};

const resolve = (database: DatabaseSync, mailboxId = "primary") =>
  Effect.runPromise(
    MailboxSenderIdentity.pipe(
      Effect.flatMap((identity) =>
        identity.resolve(Schema.decodeUnknownSync(MailboxId)(mailboxId))
      ),
      Effect.provide(senderIdentityLive(database))
    )
  );

const insertMailbox = (
  database: DatabaseSync,
  options: {
    readonly displayName?: string | null;
    readonly enabled?: number;
    readonly isPrimary?: number;
    readonly status?: "active" | "suspended";
  } = {}
) => {
  insertFreshCutoverOrganization(database, 1000);
  database
    .prepare(
      `insert into app_mailbox
        (id, display_name, status, created_by_user_id, created_at, updated_at)
       values ('primary', 'Inbox', ?, 'user-a', 1000, 1000)`
    )
    .run("active");
  if (options.status === "suspended") {
    database
      .prepare(
        "update app_mailbox set status = 'suspended' where id = 'primary'"
      )
      .run();
  }
  database
    .prepare(
      `insert into app_mailbox_address
        (mailbox_id, id, address, normalized_address, display_name, is_primary,
         enabled, created_at, updated_at)
       values ('primary', 'address-primary', 'Owner@example.test',
               'Owner@example.test', ?, ?, ?, 1000, 1000)`
    )
    .run(
      options.displayName === undefined ? "Mailbox Owner" : options.displayName,
      options.isPrimary ?? 1,
      options.enabled ?? 1
    );
};

describe("mailbox sender identity", () => {
  it("preserves the primary address display name", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      insertMailbox(database);

      await expect(resolve(database)).resolves.toMatchObject({
        address: "Owner@example.test",
        displayName: "Mailbox Owner",
      });
    } finally {
      database.close();
    }
  });

  it("requires one enabled primary address on an active mailbox", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      insertMailbox(database, { isPrimary: 0 });

      await expect(resolve(database)).rejects.toMatchObject({
        _tag: "MailboxSenderIdentityError",
        mailboxId: "primary",
        reason: "not-found",
      });

      database.exec(`
        update app_mailbox_address
           set enabled = 1, is_primary = 1
         where mailbox_id = 'primary';
        update app_mailbox
           set status = 'suspended', updated_at = 2000, version = 2
         where id = 'primary';
      `);

      await expect(resolve(database)).rejects.toMatchObject({
        reason: "not-found",
      });
    } finally {
      database.close();
    }
  });

  it("reports control-plane failures as storage errors", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      database.exec("drop table app_mailbox_address");

      await expect(resolve(database)).rejects.toMatchObject({
        _tag: "MailboxSenderIdentityError",
        reason: "storage",
      });
    } finally {
      database.close();
    }
  });
});
