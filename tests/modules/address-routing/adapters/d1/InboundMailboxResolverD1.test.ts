import { DatabaseSync } from "node:sqlite";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { InboundMailboxResolverD1Layer } from "#/modules/address-routing/adapters/d1/InboundMailboxResolverD1";
import { InboundMailboxResolver } from "#/modules/address-routing/ports/InboundMailboxResolver";
import {
  ControlPlaneD1Binding,
  ControlPlaneDatabaseLayer,
} from "#/platform/control-plane-d1/ControlPlaneDatabase";
import { EmailAddress } from "#/shared/EmailAddress";

import {
  applyControlPlaneMigrations,
  insertFreshCutoverOrganization,
  makeTestD1Database,
} from "../../../../support/d1";

const resolverLive = (database: DatabaseSync) => {
  const bindingLive = Layer.succeed(
    ControlPlaneD1Binding,
    ControlPlaneD1Binding.of({
      database: makeTestD1Database(database) as unknown as D1Database,
    })
  );
  const databaseLive = ControlPlaneDatabaseLayer.pipe(
    Layer.provide(bindingLive)
  );

  return InboundMailboxResolverD1Layer.pipe(Layer.provide(databaseLive));
};

const resolve = (database: DatabaseSync, recipient: string) =>
  Effect.runPromise(
    InboundMailboxResolver.pipe(
      Effect.flatMap((resolver) =>
        resolver.resolve(Schema.decodeUnknownSync(EmailAddress)(recipient))
      ),
      Effect.provide(resolverLive(database))
    )
  );

const insertRoute = (
  database: DatabaseSync,
  options: {
    readonly address?: string;
    readonly enabled?: number;
    readonly isPrimary?: number;
    readonly mailboxId?: string;
    readonly normalizedAddress?: string;
    readonly status?: "active" | "deleted" | "deleting" | "suspended";
  } = {}
) => {
  const mailboxId = options.mailboxId ?? "primary";
  const status = options.status ?? "active";
  insertFreshCutoverOrganization(database, 1000);
  database
    .prepare(
      `insert into app_mailbox
        (id, display_name, status, created_by_user_id, created_at, updated_at,
         deleted_at)
       values (?, 'Inbox', ?, 'user-a', 1000, 1000, ?)`
    )
    .run("primary", "active", null);
  if (mailboxId !== "primary") {
    database.exec("drop trigger app_organization_mailbox_creation_provenance");
    // Deliberately forge a pre-validation corruption that retained ancestry now
    // prevents in normal operation.
    database.exec("pragma foreign_keys = off");
    database
      .prepare("update app_mailbox set id = ? where id = 'primary'")
      .run(mailboxId);
    database.exec("pragma foreign_keys = on");
  }
  if (status !== "active") {
    database
      .prepare(
        `update app_mailbox
            set status = ?, deleted_at = ?
          where id = ?`
      )
      .run(status, status === "deleted" ? 1000 : null, mailboxId);
  }
  database
    .prepare(
      `insert into app_mailbox_address
        (mailbox_id, id, address, normalized_address, is_primary, enabled,
         created_at, updated_at)
       values (?, 'primary', ?, ?, ?, ?, 1000, 1000)`
    )
    .run(
      mailboxId,
      options.address ?? "Owner@example.test",
      options.normalizedAddress ?? "Owner@example.test",
      options.isPrimary ?? 1,
      options.enabled ?? 1
    );
};

describe("inbound mailbox resolver", () => {
  it("resolves an active route using envelope-domain normalization", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      insertRoute(database);

      await expect(resolve(database, "Owner@EXAMPLE.TEST")).resolves.toBe(
        "primary"
      );
      await expect(
        resolve(database, "owner@example.test")
      ).rejects.toMatchObject({ reason: "unknown-recipient" });
    } finally {
      database.close();
    }
  });

  it("does not route disabled addresses or inactive mailboxes", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      insertRoute(database, { enabled: 0, isPrimary: 0 });

      await expect(
        resolve(database, "Owner@example.test")
      ).rejects.toMatchObject({ reason: "unknown-recipient" });

      database.exec(`
        update app_mailbox_address
           set enabled = 1, is_primary = 1
         where mailbox_id = 'primary';
        update app_mailbox
           set status = 'suspended', updated_at = 2000, version = 2
         where id = 'primary';
      `);

      await expect(
        resolve(database, "Owner@example.test")
      ).rejects.toMatchObject({ reason: "unknown-recipient" });
    } finally {
      database.close();
    }
  });

  it("distinguishes storage failures from unknown recipients", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      database.exec("drop table app_mailbox_address");

      await expect(
        resolve(database, "Owner@example.test")
      ).rejects.toMatchObject({ reason: "processing-unavailable" });
    } finally {
      database.close();
    }
  });

  it("validates persisted mailbox IDs before routing", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      insertRoute(database, { mailboxId: " primary " });

      await expect(
        resolve(database, "Owner@example.test")
      ).rejects.toMatchObject({ reason: "processing-unavailable" });
    } finally {
      database.close();
    }
  });

  it("enforces globally unique routes and one enabled primary address", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      insertRoute(database);

      expect(() =>
        database
          .prepare(
            `insert into app_mailbox_address
              (mailbox_id, id, address, normalized_address, is_primary,
               enabled, created_at, updated_at)
             values ('primary', 'duplicate', 'Other@example.test',
                     'Owner@example.test', 0, 1, 1000, 1000)`
          )
          .run()
      ).toThrow(/constraint failed/iu);
      expect(() =>
        database
          .prepare(
            `insert into app_mailbox_address
              (mailbox_id, id, address, normalized_address, is_primary,
               enabled, created_at, updated_at)
             values ('primary', 'disabled-primary', 'Other@example.test',
                     'Other@example.test', 1, 0, 1000, 1000)`
          )
          .run()
      ).toThrow(/constraint failed/iu);
    } finally {
      database.close();
    }
  });
});
