import type { CurrentPrincipal } from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { MailAuthorizationError } from "../authorization/mail-authorization";
import { MailAuthorization } from "../authorization/mail-authorization";
import {
  DraftId,
  MailboxId,
  OperationId,
  OutboundDeliveryId,
  Version,
} from "./core";
import { MailboxDomainError } from "./errors";
import type { MailboxRepositoryError } from "./errors";
import { OutboundDeliverySchema, ScheduleOutboundResult } from "./outbound";
import { MailboxRepository } from "./repository";

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
  readonly reason: "conflict" | "invalid-input" | "not-found" | "storage";
}> {}

export interface MailboxOutboundSending {
  readonly send: (
    command: SendMailboxDraftCommand
  ) => Effect.Effect<
    SendMailboxDraftResult,
    MailAuthorizationError | MailboxOutboundSendingError,
    CurrentPrincipal
  >;
  readonly undo: (
    command: UndoMailboxSendCommand
  ) => Effect.Effect<
    UndoMailboxSendResult,
    MailAuthorizationError | MailboxOutboundSendingError,
    CurrentPrincipal
  >;
}

export const MailboxOutboundSending = Context.Service<MailboxOutboundSending>(
  "cloudflare-inbox/MailboxOutboundSending"
);

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

export const MailboxOutboundSendingLive = Layer.effect(
  MailboxOutboundSending,
  Effect.gen(function* () {
    const authorization = yield* MailAuthorization;
    const repository = yield* MailboxRepository;

    return MailboxOutboundSending.of({
      send: (command) =>
        Effect.gen(function* () {
          yield* authorization.requireDraft({
            action: "send",
            resource: {
              _tag: "Draft",
              draftId: command.draftId,
              mailboxId: command.mailboxId,
            },
          });
          const result = yield* repository
            .scheduleOutbound(command)
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
    });
  })
);
