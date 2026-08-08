import { CurrentActor } from "@effect-auth/core/Sessions";
import { and, eq, isNull, sql } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { MailboxAuthorization } from "#/modules/mailbox/ports/MailboxAuthorization";
import {
  appMailbox,
  appMailboxMember,
  appUserMailboxContactPreference,
} from "#/modules/organization/adapters/d1/OrganizationSchema";
import {
  MailboxContactPreference,
  UserMailboxContactPreferenceError,
  UserMailboxContactPreferences,
} from "#/modules/organization/application/UserMailboxContactPreferences";
import type {
  GetMailboxContactPreferenceQuery,
  UpdateMailboxContactPreferenceCommand,
} from "#/modules/organization/application/UserMailboxContactPreferences";
import { UserMailboxContactPreferenceStore } from "#/modules/organization/ports/UserMailboxContactPreferenceStore";
import { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import { appOrganization } from "#/platform/control-plane-d1/OrganizationRootSchema";

const preferenceError = (
  reason: UserMailboxContactPreferenceError["reason"],
  cause?: unknown
) => new UserMailboxContactPreferenceError({ cause, reason });

const defaultPreference = (
  mailboxId: GetMailboxContactPreferenceQuery["mailboxId"]
) =>
  Schema.decodeUnknownSync(MailboxContactPreference)({
    allParticipantsEnabledAt: null,
    mailboxId,
    version: 0,
    visibility: "safe",
  });

const UserMailboxContactPreferenceStoreD1Layer = Layer.effect(
  UserMailboxContactPreferenceStore,
  Effect.gen(function* () {
    const authorization = yield* MailboxAuthorization;
    const database = yield* ControlPlaneDatabase;

    const context = (
      mailboxId: GetMailboxContactPreferenceQuery["mailboxId"]
    ) =>
      Effect.gen(function* () {
        yield* authorization.requireMailboxMessageRead({
          resource: { _tag: "Mailbox", mailboxId },
        });
        const actor = yield* CurrentActor;
        const [mailbox] = yield* database
          .select({ organizationId: appMailbox.organizationId })
          .from(appMailboxMember)
          .innerJoin(appMailbox, eq(appMailbox.id, appMailboxMember.mailboxId))
          .innerJoin(
            appOrganization,
            eq(appOrganization.id, appMailbox.organizationId)
          )
          .where(
            and(
              eq(appMailboxMember.mailboxId, mailboxId),
              eq(appMailboxMember.userId, actor.userId),
              isNull(appMailboxMember.revokedAt),
              eq(appMailbox.status, "active"),
              isNull(appMailbox.deletedAt),
              eq(appOrganization.status, "active")
            )
          )
          .limit(1)
          .pipe(Effect.mapError((cause) => preferenceError("storage", cause)));
        if (mailbox?.organizationId === null || mailbox === undefined) {
          return yield* preferenceError("not-found");
        }
        return { actor, organizationId: mailbox.organizationId };
      });

    const get = (query: GetMailboxContactPreferenceQuery) =>
      Effect.gen(function* () {
        const { actor } = yield* context(query.mailboxId);
        const [row] = yield* database
          .select()
          .from(appUserMailboxContactPreference)
          .where(
            and(
              eq(appUserMailboxContactPreference.mailboxId, query.mailboxId),
              eq(appUserMailboxContactPreference.userId, actor.userId)
            )
          )
          .limit(1)
          .pipe(Effect.mapError((cause) => preferenceError("storage", cause)));
        return row === undefined
          ? defaultPreference(query.mailboxId)
          : Schema.decodeUnknownSync(MailboxContactPreference)({
              allParticipantsEnabledAt: row.allParticipantsEnabledAt,
              mailboxId: row.mailboxId,
              version: row.version,
              visibility: row.visibility,
            });
      });

    const update = (command: UpdateMailboxContactPreferenceCommand) =>
      Effect.gen(function* () {
        const { actor, organizationId } = yield* context(command.mailboxId);
        const now = yield* Clock.currentTimeMillis;
        if (command.expectedVersion === 0) {
          const [created] = yield* database
            .insert(appUserMailboxContactPreference)
            .values({
              allParticipantsEnabledAt:
                command.visibility === "all-participants" ? now : null,
              createdAt: now,
              mailboxId: command.mailboxId,
              organizationId,
              updatedAt: now,
              userId: actor.userId,
              version: 1,
              visibility: command.visibility,
            })
            .onConflictDoNothing()
            .returning()
            .pipe(
              Effect.mapError((cause) => preferenceError("storage", cause))
            );
          if (created === undefined) {
            return yield* preferenceError("conflict");
          }
          return Schema.decodeUnknownSync(MailboxContactPreference)({
            allParticipantsEnabledAt: created.allParticipantsEnabledAt,
            mailboxId: created.mailboxId,
            version: created.version,
            visibility: created.visibility,
          });
        }

        const [current] = yield* database
          .select()
          .from(appUserMailboxContactPreference)
          .where(
            and(
              eq(appUserMailboxContactPreference.mailboxId, command.mailboxId),
              eq(appUserMailboxContactPreference.userId, actor.userId)
            )
          )
          .limit(1)
          .pipe(Effect.mapError((cause) => preferenceError("storage", cause)));
        if (
          current === undefined ||
          current.version !== command.expectedVersion
        ) {
          return yield* preferenceError("conflict");
        }
        const enabledAt =
          command.visibility === "safe"
            ? null
            : current.visibility === "all-participants"
              ? current.allParticipantsEnabledAt
              : now;
        const [updated] = yield* database
          .update(appUserMailboxContactPreference)
          .set({
            allParticipantsEnabledAt: enabledAt,
            updatedAt: now,
            version: sql`${appUserMailboxContactPreference.version} + 1`,
            visibility: command.visibility,
          })
          .where(
            and(
              eq(appUserMailboxContactPreference.mailboxId, command.mailboxId),
              eq(appUserMailboxContactPreference.userId, actor.userId),
              eq(
                appUserMailboxContactPreference.version,
                command.expectedVersion
              )
            )
          )
          .returning()
          .pipe(Effect.mapError((cause) => preferenceError("storage", cause)));
        if (updated === undefined) {
          return yield* preferenceError("conflict");
        }
        return Schema.decodeUnknownSync(MailboxContactPreference)({
          allParticipantsEnabledAt: updated.allParticipantsEnabledAt,
          mailboxId: updated.mailboxId,
          version: updated.version,
          visibility: updated.visibility,
        });
      });

    return UserMailboxContactPreferenceStore.of({ get, update });
  })
);

export const UserMailboxContactPreferencesD1Layer =
  UserMailboxContactPreferences.layerNoDeps.pipe(
    Layer.provide(UserMailboxContactPreferenceStoreD1Layer)
  );
