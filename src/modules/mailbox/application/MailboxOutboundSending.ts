/* oxlint-disable max-classes-per-file -- Outbound commands, error and service form one cohesive use case. */
import type { CurrentPrincipal } from "@effect-auth/core/Permission";
import * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  DraftId,
  MailboxId,
  OutboundDeliveryId,
} from "#/modules/mailbox/domain/Mailbox";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import {
  OutboundDeliverySchema,
  ScheduleOutboundResult,
} from "#/modules/mailbox/domain/MailboxOutbound";
import { MailboxAuthorization } from "#/modules/mailbox/ports/MailboxAuthorization";
import type { MailboxAuthorizationError } from "#/modules/mailbox/ports/MailboxAuthorization";
import { CurrentMailboxOperationProvenance } from "#/modules/mailbox/ports/MailboxOperationProvenance";
import { MailboxOutboundSendingRepository } from "#/modules/mailbox/ports/MailboxOutboundSendingRepository";
import type { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";
import { MailboxSenderIdentity } from "#/modules/mailbox/ports/MailboxSenderIdentity";
import type { MailboxSenderIdentityError } from "#/modules/mailbox/ports/MailboxSenderIdentity";
import { OperationId } from "#/shared/Operation";
import { Version } from "#/shared/Temporal";

export const SendMailboxDraftCommand = Schema.Struct({
  mailboxId: MailboxId,
  draftId: DraftId,
  expectedVersion: Version,
  operationId: OperationId,
});
export type SendMailboxDraftCommand = Schema.Schema.Type<
  typeof SendMailboxDraftCommand
>;

export const SendMailboxDraftResult = ScheduleOutboundResult;
export type SendMailboxDraftResult = Schema.Schema.Type<
  typeof SendMailboxDraftResult
>;

export const UndoMailboxSendCommand = Schema.Struct({
  mailboxId: MailboxId,
  outboundDeliveryId: OutboundDeliveryId,
  expectedVersion: Version,
  operationId: OperationId,
});
export type UndoMailboxSendCommand = Schema.Schema.Type<
  typeof UndoMailboxSendCommand
>;

export const UndoMailboxSendResult = OutboundDeliverySchema;
export type UndoMailboxSendResult = Schema.Schema.Type<
  typeof UndoMailboxSendResult
>;

export class MailboxOutboundSendingError extends Data.TaggedError(
  "MailboxOutboundSendingError"
)<{
  readonly cause?: unknown;
  readonly message: string;
  readonly operation: "send" | "undo";
  readonly reason:
    | "conflict"
    | "invalid-input"
    | "not-found"
    | "storage"
    | "user-action-required";
}> {}

export interface MailboxOutboundSendingService {
  readonly send: (
    command: SendMailboxDraftCommand
  ) => Effect.Effect<
    SendMailboxDraftResult,
    MailboxAuthorizationError | MailboxOutboundSendingError,
    CurrentPrincipal
  >;
  readonly undo: (
    command: UndoMailboxSendCommand
  ) => Effect.Effect<
    UndoMailboxSendResult,
    MailboxAuthorizationError | MailboxOutboundSendingError,
    CurrentPrincipal
  >;
}

const sendingError = (
  operation: MailboxOutboundSendingError["operation"],
  reason: MailboxOutboundSendingError["reason"],
  cause?: unknown
) =>
  new MailboxOutboundSendingError({
    cause,
    message:
      reason === "conflict"
        ? operation === "send"
          ? "Draft changed"
          : "Outbound delivery changed"
        : reason === "user-action-required"
          ? "Explicit user action is required for outbound delivery"
          : reason === "invalid-input"
            ? "Outbound request is invalid"
            : reason === "not-found"
              ? operation === "send"
                ? "Draft was not found"
                : "Outbound delivery was not found"
              : "Outbound operation failed",
    operation,
    reason,
  });

const mapRepositoryError = (
  operation: MailboxOutboundSendingError["operation"],
  error: MailboxDomainError | MailboxRepositoryError
) => {
  if (!(error instanceof MailboxDomainError)) {
    return sendingError(operation, "storage", error);
  }
  if (error.reason === "not-found") {
    return sendingError(operation, "not-found");
  }
  if (error.reason === "validation") {
    return sendingError(operation, "invalid-input");
  }
  return error.reason === "version-conflict" ||
    error.reason === "idempotency-conflict" ||
    error.reason === "invalid-state"
    ? sendingError(operation, "conflict")
    : sendingError(operation, "storage", error);
};

const mapSenderIdentityError = (error: MailboxSenderIdentityError) =>
  sendingError(
    "send",
    error.reason === "not-found" ? "invalid-input" : "storage",
    error
  );

const verifyMailboxIdentity = (
  operation: MailboxOutboundSendingError["operation"],
  mailboxId: MailboxId,
  resultMailboxId: MailboxId
) =>
  resultMailboxId === mailboxId
    ? Effect.void
    : Effect.fail(
        sendingError(
          operation,
          "storage",
          new Error("Outbound mailbox identity invariant failed")
        )
      );

const requireExplicitSendAction = (command: SendMailboxDraftCommand) =>
  Effect.gen(function* () {
    const principal = yield* AuthPermission.CurrentPrincipal;
    const provenance = yield* Effect.serviceOption(
      CurrentMailboxOperationProvenance
    );
    if (
      provenance._tag === "None" ||
      provenance.value._tag !== "ExplicitUserAction"
    ) {
      return yield* sendingError("send", "user-action-required");
    }
    const action = provenance.value;
    if (
      principal.type !== "user" ||
      principal.id !== action.actor.userId ||
      action.actor.userId !== action.session.userId ||
      action.actor.sessionId !== action.session.sessionId ||
      action.action !== "send-draft" ||
      action.mailboxId !== command.mailboxId ||
      action.resource._tag !== "Draft" ||
      action.resource.draftId !== command.draftId ||
      action.expectedVersion !== command.expectedVersion ||
      action.operationId !== command.operationId
    ) {
      return yield* sendingError("send", "user-action-required");
    }
  });

export class MailboxOutboundSending extends Context.Service<
  MailboxOutboundSending,
  MailboxOutboundSendingService
>()("cloudflare-inbox/MailboxOutboundSending", {
  make: Effect.gen(function* () {
    const authorization = yield* MailboxAuthorization;
    const repository = yield* MailboxOutboundSendingRepository;
    const senderIdentity = yield* MailboxSenderIdentity;

    return {
      send: (command) =>
        Effect.gen(function* () {
          yield* requireExplicitSendAction(command);
          yield* authorization.requireDraft({
            action: "send",
            resource: {
              _tag: "Draft",
              draftId: command.draftId,
              mailboxId: command.mailboxId,
            },
          });
          const sender = yield* senderIdentity
            .resolve(command.mailboxId)
            .pipe(Effect.mapError(mapSenderIdentityError));
          const result = yield* repository
            .scheduleOutbound({
              ...command,
              confirmation: "explicit-user-action",
              sender,
            })
            .pipe(
              Effect.mapError((error) => mapRepositoryError("send", error))
            );
          yield* verifyMailboxIdentity(
            "send",
            command.mailboxId,
            result.delivery.mailboxId
          );
          return result;
        }),
      undo: (command) =>
        Effect.gen(function* () {
          yield* authorization.requireMailboxDraftSend({
            resource: { _tag: "Mailbox", mailboxId: command.mailboxId },
          });
          const delivery = yield* repository
            .cancelOutboundDelivery(command)
            .pipe(
              Effect.mapError((error) => mapRepositoryError("undo", error))
            );
          yield* verifyMailboxIdentity(
            "undo",
            command.mailboxId,
            delivery.mailboxId
          );
          if (delivery.id !== command.outboundDeliveryId) {
            return yield* sendingError(
              "undo",
              "storage",
              new Error("Outbound delivery identity invariant failed")
            );
          }
          return delivery;
        }),
    } satisfies MailboxOutboundSendingService;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
