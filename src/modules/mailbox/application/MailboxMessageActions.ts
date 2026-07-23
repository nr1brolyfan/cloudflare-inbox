/* oxlint-disable max-classes-per-file -- Action contract, error and service form one cohesive use case. */
import type { CurrentPrincipal } from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { MailAuthorizationError } from "#/authorization/mail-authorization";
import { MailAuthorization } from "#/authorization/mail-authorization";
import {
  FolderId,
  MailboxId,
  MessageId,
  OperationId,
  Version,
} from "#/modules/mailbox/domain/Mailbox";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import type { MessageMutationResult } from "#/modules/mailbox/domain/MailboxMessage";
import { MailboxDirectoryRepository } from "#/modules/mailbox/ports/MailboxDirectoryRepository";
import { MailboxMessageRepository } from "#/modules/mailbox/ports/MailboxMessageRepository";
import type { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";

const ActionFields = {
  expectedVersion: Version,
  operationId: OperationId,
};

export const MailboxMessageActionPayload = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("SetRead"),
    ...ActionFields,
    read: Schema.Boolean,
  }),
  Schema.Struct({
    _tag: Schema.Literal("SetStarred"),
    ...ActionFields,
    starred: Schema.Boolean,
  }),
  Schema.Struct({ _tag: Schema.Literal("Archive"), ...ActionFields }),
  Schema.Struct({ _tag: Schema.Literal("Trash"), ...ActionFields }),
]);
export type MailboxMessageActionPayload = Schema.Schema.Type<
  typeof MailboxMessageActionPayload
>;

export const MailboxMessageActionCommand = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("SetRead"),
    ...ActionFields,
    mailboxId: MailboxId,
    messageId: MessageId,
    read: Schema.Boolean,
  }),
  Schema.Struct({
    _tag: Schema.Literal("SetStarred"),
    ...ActionFields,
    mailboxId: MailboxId,
    messageId: MessageId,
    starred: Schema.Boolean,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Archive"),
    ...ActionFields,
    mailboxId: MailboxId,
    messageId: MessageId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Trash"),
    ...ActionFields,
    mailboxId: MailboxId,
    messageId: MessageId,
  }),
]);
export type MailboxMessageActionCommand = Schema.Schema.Type<
  typeof MailboxMessageActionCommand
>;

export const MailboxMessageActionResult = Schema.Struct({
  folderId: FolderId,
  id: MessageId,
  read: Schema.Boolean,
  starred: Schema.Boolean,
  version: Version,
});
export type MailboxMessageActionResult = Schema.Schema.Type<
  typeof MailboxMessageActionResult
>;

export class MailboxMessageActionError extends Data.TaggedError(
  "MailboxMessageActionError"
)<{
  readonly cause?: unknown;
  readonly message: string;
  readonly reason: "conflict" | "invalid-input" | "not-found" | "storage";
}> {}

export interface MailboxMessageActionsService {
  readonly execute: (
    command: MailboxMessageActionCommand
  ) => Effect.Effect<
    MailboxMessageActionResult,
    MailAuthorizationError | MailboxMessageActionError,
    CurrentPrincipal
  >;
}

const actionError = (
  reason: MailboxMessageActionError["reason"],
  cause?: unknown
) =>
  new MailboxMessageActionError({
    cause,
    message:
      reason === "conflict"
        ? "Mailbox message changed"
        : reason === "invalid-input"
          ? "Mailbox message action is invalid"
          : reason === "not-found"
            ? "Mailbox message was not found"
            : "Mailbox message could not be changed",
    reason,
  });

const mapRepositoryError = (
  error: MailboxDomainError | MailboxRepositoryError
) => {
  if (!(error instanceof MailboxDomainError)) {
    return actionError("storage", error);
  }
  if (error.reason === "not-found") {
    return actionError("not-found");
  }
  if (error.reason === "validation") {
    return actionError("invalid-input");
  }
  return error.reason === "version-conflict" ||
    error.reason === "idempotency-conflict"
    ? actionError("conflict")
    : actionError("storage", error);
};

const projectResult = (result: MessageMutationResult) =>
  Schema.decodeUnknownEffect(MailboxMessageActionResult)({
    folderId: result.folderId,
    id: result.id,
    read: result.read,
    starred: result.starred,
    version: result.version,
  }).pipe(Effect.mapError((cause) => actionError("storage", cause)));

/** Authorized message mutations with server-resolved archive and trash targets. */
export class MailboxMessageActions extends Context.Service<
  MailboxMessageActions,
  MailboxMessageActionsService
>()("cloudflare-inbox/MailboxMessageActions", {
  make: Effect.gen(function* () {
    const authorization = yield* MailAuthorization;
    const directory = yield* MailboxDirectoryRepository;
    const messages = yield* MailboxMessageRepository;

    return {
      execute: (command) =>
        Effect.gen(function* () {
          yield* authorization.requireMessage({
            action: "modify",
            resource: {
              _tag: "Message",
              mailboxId: command.mailboxId,
              messageId: command.messageId,
            },
          });

          let result: MessageMutationResult;
          if (command._tag === "SetRead") {
            result = yield* messages
              .setMessageRead(command)
              .pipe(Effect.mapError(mapRepositoryError));
          } else if (command._tag === "SetStarred") {
            result = yield* messages
              .setMessageStarred(command)
              .pipe(Effect.mapError(mapRepositoryError));
          } else {
            const kind = command._tag === "Archive" ? "archive" : "trash";
            const folders = yield* directory
              .listFolders({ mailboxId: command.mailboxId })
              .pipe(Effect.mapError(mapRepositoryError));
            const targets = folders.items.filter(
              (folder) =>
                folder.mailboxId === command.mailboxId && folder.kind === kind
            );
            const [target] = targets;
            if (target === undefined || targets.length !== 1) {
              return yield* actionError(
                "storage",
                new Error(`Expected exactly one ${kind} folder`)
              );
            }
            yield* authorization.requireFolder({
              action: "modify",
              resource: {
                _tag: "Folder",
                folderId: target.id,
                mailboxId: command.mailboxId,
              },
            });
            result = yield* messages
              .moveMessage({
                expectedVersion: command.expectedVersion,
                folderId: target.id,
                mailboxId: command.mailboxId,
                messageId: command.messageId,
                operationId: command.operationId,
              })
              .pipe(Effect.mapError(mapRepositoryError));
          }

          if (
            result.mailboxId !== command.mailboxId ||
            result.id !== command.messageId
          ) {
            return yield* actionError(
              "storage",
              new Error("Mailbox message action identity invariant failed")
            );
          }
          return yield* projectResult(result);
        }),
    } satisfies MailboxMessageActionsService;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
