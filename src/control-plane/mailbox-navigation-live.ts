import { CurrentActor } from "@effect-auth/core/Sessions";
import { and, eq, isNull } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  MailboxDisplayName,
  MailboxId,
} from "#/modules/mailbox/domain/Mailbox";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import { MailboxAuthorization } from "#/modules/mailbox/ports/MailboxAuthorization";
import { MailboxDirectoryRepository } from "#/modules/mailbox/ports/MailboxDirectoryRepository";
import {
  MailboxNavigation,
  MailboxNavigationError,
  MailboxNavigationResult,
} from "#/modules/organization/application/MailboxNavigation";

import { ControlPlaneDatabase } from "../platform/control-plane-d1/ControlPlaneDatabase";
import {
  appMailbox,
  appMailboxMember,
} from "../platform/control-plane-d1/ControlPlaneSchema";

const navigationError = (reason: "not-found" | "storage", cause?: unknown) =>
  new MailboxNavigationError({
    cause,
    message:
      reason === "not-found"
        ? "Current mailbox was not found"
        : "Mailbox navigation could not be loaded",
    reason,
  });

const mapDirectoryError = (error: MailboxDomainError | unknown) =>
  error instanceof MailboxDomainError && error.reason === "not-found"
    ? navigationError("not-found")
    : navigationError("storage", error);

/** D1 mailbox discovery combined with authorized MailboxDO directory reads. */
export const MailboxNavigationLive = Layer.effect(
  MailboxNavigation,
  Effect.gen(function* () {
    const authorization = yield* MailboxAuthorization;
    const controlPlane = yield* ControlPlaneDatabase;
    const directoryRepository = yield* MailboxDirectoryRepository;

    return MailboxNavigation.of({
      getCurrent: Effect.gen(function* () {
        const actor = yield* CurrentActor;
        const [row] = yield* controlPlane
          .select({
            displayName: appMailbox.displayName,
            id: appMailbox.id,
          })
          .from(appMailboxMember)
          .innerJoin(appMailbox, eq(appMailbox.id, appMailboxMember.mailboxId))
          .where(
            and(
              eq(appMailboxMember.userId, actor.userId),
              isNull(appMailboxMember.revokedAt),
              eq(appMailbox.status, "active"),
              isNull(appMailbox.deletedAt)
            )
          )
          .limit(1)
          .pipe(Effect.mapError((cause) => navigationError("storage", cause)));

        if (row === undefined) {
          return yield* navigationError("not-found");
        }

        const mailbox = yield* Schema.decodeUnknownEffect(
          Schema.Struct({ id: MailboxId, displayName: MailboxDisplayName })
        )(row).pipe(
          Effect.mapError((cause) => navigationError("storage", cause))
        );
        yield* authorization.requireMailbox({
          action: "read",
          resource: { _tag: "Mailbox", mailboxId: mailbox.id },
        });
        const directory = yield* Effect.all(
          {
            folders: directoryRepository.listFolders({ mailboxId: mailbox.id }),
            labels: directoryRepository.listLabels({ mailboxId: mailbox.id }),
          },
          { concurrency: 2 }
        ).pipe(Effect.mapError(mapDirectoryError));

        if (
          directory.folders.items.some(
            (folder) => folder.mailboxId !== mailbox.id
          ) ||
          directory.labels.items.some((label) => label.mailboxId !== mailbox.id)
        ) {
          return yield* navigationError(
            "storage",
            new Error("Mailbox directory identity invariant failed")
          );
        }

        return yield* Schema.decodeUnknownEffect(MailboxNavigationResult)({
          folders: directory.folders.items.map((folder) => ({
            id: folder.id,
            kind: folder.kind,
            messageCount: folder.messageCount,
            name: folder.name,
            unreadCount: folder.unreadCount,
          })),
          labels: directory.labels.items.map((label) => ({
            id: label.id,
            name: label.name,
          })),
          mailbox,
        }).pipe(Effect.mapError((cause) => navigationError("storage", cause)));
      }),
    });
  })
);
