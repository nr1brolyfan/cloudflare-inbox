import { DatabaseSync } from "node:sqlite";

import { SessionId, UserId } from "@effect-auth/core/Identifiers";
import {
  CurrentPrincipal,
  PermissionSubject,
} from "@effect-auth/core/Permission";
import { CurrentActor } from "@effect-auth/core/Sessions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import { MailboxAuthorization } from "#/modules/mailbox/ports/MailboxAuthorization";
import type { MailboxAuthorizationService } from "#/modules/mailbox/ports/MailboxAuthorization";
import { UserMailboxContactPreferencesD1Layer } from "#/modules/organization/adapters/d1/UserMailboxContactPreferencesD1";
import {
  UpdateMailboxContactPreferenceCommand,
  UserMailboxContactPreferences,
} from "#/modules/organization/application/UserMailboxContactPreferences";
import {
  ControlPlaneD1Binding,
  ControlPlaneDatabaseLayer,
} from "#/platform/control-plane-d1/ControlPlaneDatabase";

import {
  applyControlPlaneMigrations,
  insertFreshCutoverOrganization,
  makeTestD1Database,
} from "../../../../support/d1";

const mailboxId = Schema.decodeUnknownSync(MailboxId)("primary");
const userId = UserId("user-a");
const requireMailboxMessageRead: MailboxAuthorizationService["requireMailboxMessageRead"] =
  ({ resource }) => Effect.succeed(resource);

const preferenceEffect = (database: DatabaseSync) => {
  const binding = Layer.succeed(
    ControlPlaneD1Binding,
    ControlPlaneD1Binding.of({
      database: makeTestD1Database(database) as unknown as D1Database,
    })
  );
  const databaseLayer = ControlPlaneDatabaseLayer.pipe(Layer.provide(binding));
  const authorization = MailboxAuthorization.of({
    requireMailboxMessageRead,
  } as unknown as MailboxAuthorizationService);
  const live = UserMailboxContactPreferencesD1Layer.pipe(
    Layer.provide(databaseLayer),
    Layer.provide(Layer.succeed(MailboxAuthorization, authorization))
  );
  return UserMailboxContactPreferences.pipe(Effect.provide(live));
};

const setup = async (database: DatabaseSync) => {
  await applyControlPlaneMigrations(database);
  insertFreshCutoverOrganization(database, 1000);
  database.exec(`
    insert into auth_user (id, created_at, updated_at)
    values ('user-a', 1000, 1000);
    insert into app_mailbox
      (id, display_name, status, created_by_user_id, created_at, updated_at)
    values ('primary', 'Primary Inbox', 'active', 'user-a', 1000, 1000);
    insert into app_mailbox_member
      (mailbox_id, user_id, created_at, updated_at)
    values ('primary', 'user-a', 1000, 1000);
  `);
};

describe("user mailbox contact preferences D1", () => {
  it("defaults safely and versions non-retroactive enablement", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await setup(database);
      const result = await Effect.runPromise(
        preferenceEffect(database).pipe(
          Effect.flatMap((preferences) =>
            Effect.gen(function* () {
              const initial = yield* preferences.get({ mailboxId });
              const enabled = yield* preferences.update(
                Schema.decodeUnknownSync(UpdateMailboxContactPreferenceCommand)(
                  {
                    expectedVersion: initial.version,
                    mailboxId,
                    visibility: "all-participants",
                  }
                )
              );
              const stale = yield* Effect.result(
                preferences.update(
                  Schema.decodeUnknownSync(
                    UpdateMailboxContactPreferenceCommand
                  )({
                    expectedVersion: initial.version,
                    mailboxId,
                    visibility: "safe",
                  })
                )
              );
              const disabled = yield* preferences.update(
                Schema.decodeUnknownSync(UpdateMailboxContactPreferenceCommand)(
                  {
                    expectedVersion: enabled.version,
                    mailboxId,
                    visibility: "safe",
                  }
                )
              );
              return { disabled, enabled, initial, stale };
            })
          ),
          Effect.provideService(
            CurrentActor,
            CurrentActor.of({ sessionId: SessionId("session-a"), userId })
          ),
          Effect.provideService(
            CurrentPrincipal,
            CurrentPrincipal.of(PermissionSubject.user(userId))
          )
        )
      );

      expect(result.initial).toStrictEqual({
        allParticipantsEnabledAt: null,
        mailboxId,
        version: 0,
        visibility: "safe",
      });
      expect(result.enabled).toMatchObject({
        mailboxId,
        version: 1,
        visibility: "all-participants",
      });
      expect(result.enabled.allParticipantsEnabledAt).toStrictEqual(
        expect.any(Number)
      );
      expect(result.stale).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "UserMailboxContactPreferenceError",
          reason: "conflict",
        },
      });
      expect(result.disabled).toStrictEqual({
        allParticipantsEnabledAt: null,
        mailboxId,
        version: 2,
        visibility: "safe",
      });
    } finally {
      database.close();
    }
  });
});
