/* oxlint-disable max-classes-per-file -- Action contract, error and service form one cohesive use case. */
import type { CurrentPrincipal } from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  FolderId,
  MailboxId,
  MessageId,
  ThreadId,
} from "#/modules/mailbox/domain/Mailbox";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import { BatchMessageMutationsInput } from "#/modules/mailbox/domain/MailboxMessage";
import type {
  BatchMessageMutation,
  BatchMessageMutationsResult,
  MessageMutationResult,
  SetThreadReadResult,
} from "#/modules/mailbox/domain/MailboxMessage";
import { MailboxAuthorization } from "#/modules/mailbox/ports/MailboxAuthorization";
import type { MailboxAuthorizationError } from "#/modules/mailbox/ports/MailboxAuthorization";
import { MailboxDirectoryRepository } from "#/modules/mailbox/ports/MailboxDirectoryRepository";
import { MailboxMessageRepository } from "#/modules/mailbox/ports/MailboxMessageRepository";
import type { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";
import { OperationId } from "#/shared/Operation";
import { Version } from "#/shared/Temporal";

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

export const MailboxMessageBatchActionItem = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("SetRead"),
    ...ActionFields,
    messageId: MessageId,
    read: Schema.Boolean,
  }),
  Schema.Struct({
    _tag: Schema.Literal("SetStarred"),
    ...ActionFields,
    messageId: MessageId,
    starred: Schema.Boolean,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Archive"),
    ...ActionFields,
    messageId: MessageId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Trash"),
    ...ActionFields,
    messageId: MessageId,
  }),
]);
export type MailboxMessageBatchActionItem = Schema.Schema.Type<
  typeof MailboxMessageBatchActionItem
>;

export const MailboxMessageBatchActionPayload = Schema.Struct({
  actions: Schema.Array(MailboxMessageBatchActionItem).pipe(
    Schema.check(Schema.isLengthBetween(1, 100))
  ),
  batchOperationId: OperationId,
});
export type MailboxMessageBatchActionPayload = Schema.Schema.Type<
  typeof MailboxMessageBatchActionPayload
>;

export const MailboxMessageBatchActionCommand = Schema.Struct({
  ...MailboxMessageBatchActionPayload.fields,
  mailboxId: MailboxId,
});
export type MailboxMessageBatchActionCommand = Schema.Schema.Type<
  typeof MailboxMessageBatchActionCommand
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

export const SetMailboxThreadReadCommand = Schema.Struct({
  mailboxId: MailboxId,
  operationId: OperationId,
  threadId: ThreadId,
});
export type SetMailboxThreadReadCommand = Schema.Schema.Type<
  typeof SetMailboxThreadReadCommand
>;

export const SetMailboxThreadReadResult = Schema.Struct({
  changed: Schema.Array(MailboxMessageActionResult),
  operationId: OperationId,
  threadId: ThreadId,
});
export type SetMailboxThreadReadResult = Schema.Schema.Type<
  typeof SetMailboxThreadReadResult
>;

export const MailboxMessageBatchActionResultItem = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Succeeded"),
    action: MailboxMessageActionResult,
    messageId: MessageId,
    operationId: OperationId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Failed"),
    messageId: MessageId,
    operationId: OperationId,
    reason: Schema.Literals([
      "conflict",
      "forbidden",
      "invalid-input",
      "not-found",
    ]),
  }),
]);
export type MailboxMessageBatchActionResultItem = Schema.Schema.Type<
  typeof MailboxMessageBatchActionResultItem
>;

export const MailboxMessageBatchActionResult = Schema.Struct({
  batchOperationId: OperationId,
  results: Schema.Array(MailboxMessageBatchActionResultItem),
});
export type MailboxMessageBatchActionResult = Schema.Schema.Type<
  typeof MailboxMessageBatchActionResult
>;

export class MailboxMessageActionError extends Data.TaggedError(
  "MailboxMessageActionError"
)<{
  readonly cause?: unknown;
  readonly message: string;
  readonly reason: "conflict" | "invalid-input" | "not-found" | "storage";
}> {}

export interface MailboxMessageActionsService {
  readonly setThreadRead: (
    command: SetMailboxThreadReadCommand
  ) => Effect.Effect<
    SetMailboxThreadReadResult,
    MailboxAuthorizationError | MailboxMessageActionError,
    CurrentPrincipal
  >;
  readonly executeBatch: (
    command: MailboxMessageBatchActionCommand
  ) => Effect.Effect<
    MailboxMessageBatchActionResult,
    MailboxAuthorizationError | MailboxMessageActionError,
    CurrentPrincipal
  >;
  readonly execute: (
    command: MailboxMessageActionCommand
  ) => Effect.Effect<
    MailboxMessageActionResult,
    MailboxAuthorizationError | MailboxMessageActionError,
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

const batchIdentityIsValid = (command: MailboxMessageBatchActionCommand) => {
  const messageIds = command.actions.map((action) => action.messageId);
  const operationIds = command.actions.map((action) => action.operationId);
  return (
    new Set(messageIds).size === messageIds.length &&
    new Set(operationIds).size === operationIds.length &&
    !operationIds.includes(command.batchOperationId)
  );
};

/** Authorized message mutations with server-resolved archive and trash targets. */
export class MailboxMessageActions extends Context.Service<
  MailboxMessageActions,
  MailboxMessageActionsService
>()("cloudflare-inbox/MailboxMessageActions", {
  make: Effect.gen(function* () {
    const authorization = yield* MailboxAuthorization;
    const directory = yield* MailboxDirectoryRepository;
    const messages = yield* MailboxMessageRepository;

    return {
      setThreadRead: (command) =>
        Effect.gen(function* () {
          yield* authorization.requireMailboxMessageModify({
            resource: { _tag: "Mailbox", mailboxId: command.mailboxId },
          });
          const result: SetThreadReadResult = yield* messages
            .setThreadRead(command)
            .pipe(Effect.mapError(mapRepositoryError));
          if (
            result.operationId !== command.operationId ||
            result.threadId !== command.threadId
          ) {
            return yield* actionError(
              "storage",
              new Error("Set thread read result identity invariant failed")
            );
          }
          const changed = yield* Effect.all(
            result.changed.map((projection) =>
              Schema.decodeUnknownEffect(MailboxMessageActionResult)(
                projection
              ).pipe(Effect.mapError((cause) => actionError("storage", cause)))
            )
          );
          return Schema.decodeUnknownSync(SetMailboxThreadReadResult)({
            changed,
            operationId: result.operationId,
            threadId: result.threadId,
          });
        }),
      executeBatch: (command) =>
        // oxlint-disable-next-line eslint/complexity -- Batch execution coordinates target resolution, per-item authorization, and partial results.
        Effect.gen(function* () {
          if (!batchIdentityIsValid(command)) {
            return yield* actionError("invalid-input");
          }

          const moveKinds = new Set(
            command.actions.flatMap((action) =>
              action._tag === "Archive"
                ? ["archive" as const]
                : action._tag === "Trash"
                  ? ["trash" as const]
                  : []
            )
          );
          const targetByKind = new Map<"archive" | "trash", FolderId>();
          const targetFailureByKind = new Map<
            "archive" | "trash",
            "forbidden" | "not-found"
          >();
          if (moveKinds.size > 0) {
            const folders = yield* directory
              .listFolders({ mailboxId: command.mailboxId })
              .pipe(Effect.mapError(mapRepositoryError));
            for (const kind of moveKinds) {
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
              targetByKind.set(kind, target.id);
              const targetAuthorization = yield* Effect.result(
                authorization.requireFolder({
                  action: "modify",
                  resource: {
                    _tag: "Folder",
                    folderId: target.id,
                    mailboxId: command.mailboxId,
                  },
                })
              );
              if (Result.isFailure(targetAuthorization)) {
                const { failure } = targetAuthorization;
                if (
                  failure._tag === "MailResourceResolveError" &&
                  failure.reason === "storage"
                ) {
                  return yield* actionError("storage", failure);
                }
                targetFailureByKind.set(
                  kind,
                  failure._tag === "MailResourceResolveError"
                    ? "not-found"
                    : "forbidden"
                );
              }
            }
          }

          const mutations: BatchMessageMutation[] = [];
          const currentRejections = new Map<
            MessageId,
            "forbidden" | "not-found"
          >();
          for (const item of command.actions) {
            const authorizationResult = yield* Effect.result(
              authorization.requireMessage({
                action: "modify",
                resource: {
                  _tag: "Message",
                  mailboxId: command.mailboxId,
                  messageId: item.messageId,
                },
              })
            );
            if (Result.isFailure(authorizationResult)) {
              const { failure } = authorizationResult;
              if (
                failure._tag === "MailResourceResolveError" &&
                failure.reason === "storage"
              ) {
                return yield* actionError("storage", failure);
              }
              const reason =
                failure._tag === "MailResourceResolveError"
                  ? "not-found"
                  : "forbidden";
              currentRejections.set(item.messageId, reason);
              mutations.push({
                _tag: "Rejected",
                messageId: item.messageId,
                operationId: item.operationId,
                reason,
              });
              continue;
            }

            if (item._tag === "Archive" || item._tag === "Trash") {
              const kind = item._tag === "Archive" ? "archive" : "trash";
              const targetFailure = targetFailureByKind.get(kind);
              if (targetFailure !== undefined) {
                currentRejections.set(item.messageId, targetFailure);
                mutations.push({
                  _tag: "Rejected",
                  messageId: item.messageId,
                  operationId: item.operationId,
                  reason: targetFailure,
                });
                continue;
              }
            }

            if (item._tag === "SetRead") {
              mutations.push({
                _tag: "Read",
                expectedVersion: item.expectedVersion,
                messageId: item.messageId,
                operationId: item.operationId,
                read: item.read,
              });
            } else if (item._tag === "SetStarred") {
              mutations.push({
                _tag: "Starred",
                expectedVersion: item.expectedVersion,
                messageId: item.messageId,
                operationId: item.operationId,
                starred: item.starred,
              });
            } else {
              const kind = item._tag === "Archive" ? "archive" : "trash";
              const folderId = targetByKind.get(kind);
              if (folderId === undefined) {
                return yield* actionError("storage");
              }
              mutations.push({
                _tag: "Move",
                expectedVersion: item.expectedVersion,
                folderId,
                folderKind: kind,
                messageId: item.messageId,
                operationId: item.operationId,
              });
            }
          }

          const repositoryResult: BatchMessageMutationsResult = yield* messages
            .batchMutateMessages(
              Schema.decodeUnknownSync(BatchMessageMutationsInput)({
                batchOperationId: command.batchOperationId,
                intents: command.actions,
                mailboxId: command.mailboxId,
                mutations,
              })
            )
            .pipe(Effect.mapError(mapRepositoryError));
          if (
            repositoryResult.batchOperationId !== command.batchOperationId ||
            repositoryResult.results.length !== command.actions.length
          ) {
            return yield* actionError(
              "storage",
              new Error("Batch message action result identity mismatch")
            );
          }
          const repositoryByMessage = new Map(
            repositoryResult.results.map((result) => [result.messageId, result])
          );
          if (repositoryByMessage.size !== command.actions.length) {
            return yield* actionError(
              "storage",
              new Error("Batch message action results were not unique")
            );
          }
          const results: MailboxMessageBatchActionResultItem[] = [];
          for (const item of command.actions) {
            const repositoryItem = repositoryByMessage.get(item.messageId);
            if (
              repositoryItem === undefined ||
              repositoryItem.operationId !== item.operationId
            ) {
              return yield* actionError(
                "storage",
                new Error("Batch message action result was incomplete")
              );
            }
            const currentRejection = currentRejections.get(item.messageId);
            if (currentRejection !== undefined) {
              results.push({
                _tag: "Failed",
                messageId: item.messageId,
                operationId: item.operationId,
                reason: currentRejection,
              });
              continue;
            }
            if (repositoryItem._tag === "Failed") {
              results.push(repositoryItem);
              continue;
            }
            if (
              repositoryItem.value.id !== item.messageId ||
              repositoryItem.value.mailboxId !== command.mailboxId
            ) {
              return yield* actionError(
                "storage",
                new Error("Batch message action item identity mismatch")
              );
            }
            results.push({
              _tag: "Succeeded",
              action: yield* projectResult(repositoryItem.value),
              messageId: item.messageId,
              operationId: item.operationId,
            });
          }
          return Schema.decodeUnknownSync(MailboxMessageBatchActionResult)({
            batchOperationId: command.batchOperationId,
            results,
          });
        }),
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
