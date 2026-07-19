import { DatabaseSync } from "node:sqlite";

import { D1EffectQbSqliteAuthStorageLive } from "@effect-auth/core/EffectQbSqliteStorage";
import { UnixMillis } from "@effect-auth/core/Identifiers";
import {
  PermissionAdministration,
  Permissions,
  PermissionSubject,
} from "@effect-auth/core/Permission";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

import { applyControlPlaneMigrations, makeTestD1Database } from "../test/d1";
import {
  MailPermission,
  MailRole,
  folderScope,
  mailboxScope,
  mailPermissionDefinitions,
  mailRolePermissions,
} from "./catalog";
import { MailPermissionsLive } from "./permissions-live";

describe("D1 mail authorization", () => {
  it("applies mailbox registry constraints and seeds the typed catalog", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      database
        .prepare(
          `insert into app_mailbox
            (id, display_name, created_by_user_id, created_at, updated_at)
           values (?, ?, ?, ?, ?)`
        )
        .run("mailbox-a", "Inbox", "user-a", 1, 1);
      database
        .prepare(
          `insert into app_mailbox_member
            (mailbox_id, user_id, created_at, updated_at)
           values (?, ?, ?, ?)`
        )
        .run("mailbox-a", "user-a", 1, 1);
      database
        .prepare(
          `insert into app_user_preference
            (user_id, default_mailbox_id, settings_json, created_at, updated_at)
           values (?, ?, ?, ?, ?)`
        )
        .run("user-a", "mailbox-a", '{"density":"compact"}', 1, 1);

      expect(() =>
        database
          .prepare(
            `insert into app_mailbox
              (id, display_name, status, created_by_user_id, created_at, updated_at)
             values (?, ?, ?, ?, ?, ?)`
          )
          .run("mailbox-b", "Broken", "deleted", "user-a", 1, 1)
      ).toThrow(/constraint/iu);
      expect(() =>
        database
          .prepare(
            `insert into app_user_preference
              (user_id, settings_json, created_at, updated_at)
             values (?, ?, ?, ?)`
          )
          .run("user-b", "[]", 1, 1)
      ).toThrow(/constraint/iu);

      const storedPermissions = database
        .prepare(
          "select id, scope_type as scopeType from auth_permission_definition"
        )
        .all() as { id: string; scopeType: string }[];
      const storedRolePermissions = database
        .prepare(
          `select role_id as role, permission_id as permission,
                  scope_type as scopeType
             from auth_role_permission`
        )
        .all() as { permission: string; role: string; scopeType: string }[];

      expect(
        Object.fromEntries(
          storedPermissions.map(({ id, scopeType }) => [id, scopeType])
        )
      ).toStrictEqual(
        Object.fromEntries(
          mailPermissionDefinitions.map(({ id, scopeType }) => [id, scopeType])
        )
      );
      expect(
        Object.fromEntries(
          storedRolePermissions.map(({ permission, role, scopeType }) => [
            `${role}:${permission}`,
            scopeType,
          ])
        )
      ).toStrictEqual(
        Object.fromEntries(
          mailRolePermissions.map(({ permission, role, scopeType }) => [
            `${role}:${permission}`,
            scopeType,
          ])
        )
      );
    } finally {
      database.close();
    }
  });

  it("provides scoped administration and permission checks from D1", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const program = Effect.gen(function* () {
        const administration = yield* PermissionAdministration;
        const permissions = yield* Permissions;
        const subject = PermissionSubject.make("user", "user-a");

        yield* administration.grantRole({
          role: MailRole.editor,
          scope: mailboxScope("mailbox-a"),
          subject,
        });

        const editorChecks = {
          anotherMailbox: yield* permissions.hasPermission({
            permission: MailPermission.messageRead,
            scope: mailboxScope("mailbox-b"),
            subject,
          }),
          canRead: yield* permissions.hasPermission({
            permission: MailPermission.messageRead,
            scope: mailboxScope("mailbox-a"),
            subject,
          }),
          canSend: yield* permissions.hasPermission({
            permission: MailPermission.mailboxSend,
            scope: mailboxScope("mailbox-a"),
            subject,
          }),
        };
        expect(editorChecks).toStrictEqual({
          anotherMailbox: false,
          canRead: true,
          canSend: false,
        });

        yield* administration.grantPermission({
          permission: MailPermission.mailboxSend,
          scope: mailboxScope("mailbox-a"),
          subject,
        });
        expect(
          yield* permissions.hasPermission({
            permission: MailPermission.mailboxSend,
            scope: mailboxScope("mailbox-a"),
            subject,
          })
        ).toBeTruthy();

        yield* administration.grantRole({
          role: MailRole.viewer,
          scope: folderScope("mailbox-a", "folder-a"),
          subject,
        });
        const folderChecks = {
          anotherFolder: yield* permissions.hasPermission({
            permission: MailPermission.folderRead,
            scope: folderScope("mailbox-a", "folder-b"),
            subject,
          }),
          canRead: yield* permissions.hasPermission({
            permission: MailPermission.folderRead,
            scope: folderScope("mailbox-a", "folder-a"),
            subject,
          }),
        };
        expect(folderChecks).toStrictEqual({
          anotherFolder: false,
          canRead: true,
        });

        yield* administration.grantPermission({
          expiresAt: UnixMillis(0),
          permission: MailPermission.mailboxExport,
          scope: mailboxScope("mailbox-a"),
          subject,
        });
        expect(
          yield* permissions.hasPermission({
            permission: MailPermission.mailboxExport,
            scope: mailboxScope("mailbox-a"),
            subject,
          })
        ).toBeFalsy();
      }).pipe(
        Effect.provide(
          MailPermissionsLive.pipe(
            Layer.provide(
              D1EffectQbSqliteAuthStorageLive(makeTestD1Database(database))
            )
          )
        )
      );

      await Effect.runPromise(program);
    } finally {
      database.close();
    }
  });
});
