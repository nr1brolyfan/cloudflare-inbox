/* oxlint-disable max-classes-per-file -- Commands share their editor projection and one public use-case error. */
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
  MailAddress,
  MailboxId,
  MessageSubject,
  OperationId,
  UnixMillis,
  Version,
} from "./core";
import type { Draft as DraftType } from "./drafts";
import { MailboxDomainError } from "./errors";
import type { MailboxRepositoryError } from "./errors";
import { MailboxRepository } from "./repository";

const DraftRecipients = Schema.Array(MailAddress).check(
  Schema.makeFilter((recipients) =>
    recipients.length <= 100 ? undefined : "at most 100 recipients are allowed"
  )
);
const DraftTextBody = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(1_000_000))
);

export const DraftEditorContent = Schema.Struct({
  to: DraftRecipients,
  cc: DraftRecipients,
  bcc: DraftRecipients,
  subject: MessageSubject,
  textBody: Schema.optional(DraftTextBody),
});
export type DraftEditorContent = Schema.Schema.Type<typeof DraftEditorContent>;

export class DraftEditorDraft extends Schema.Class<DraftEditorDraft>(
  "cloudflare-inbox/DraftEditorDraft"
)({
  id: DraftId,
  mailboxId: MailboxId,
  content: DraftEditorContent,
  createdAt: UnixMillis,
  updatedAt: UnixMillis,
  version: Version,
}) {}

export const CreateMailboxDraftCommand = Schema.Struct({
  mailboxId: MailboxId,
  operationId: OperationId,
  content: DraftEditorContent,
});
export type CreateMailboxDraftCommand = Schema.Schema.Type<
  typeof CreateMailboxDraftCommand
>;

export const GetMailboxDraftQuery = Schema.Struct({
  mailboxId: MailboxId,
  draftId: DraftId,
});
export type GetMailboxDraftQuery = Schema.Schema.Type<
  typeof GetMailboxDraftQuery
>;

export const UpdateMailboxDraftCommand = Schema.Struct({
  mailboxId: MailboxId,
  draftId: DraftId,
  operationId: OperationId,
  expectedVersion: Version,
  content: DraftEditorContent,
});
export type UpdateMailboxDraftCommand = Schema.Schema.Type<
  typeof UpdateMailboxDraftCommand
>;

export class MailboxDraftEditingError extends Data.TaggedError(
  "MailboxDraftEditingError"
)<{
  readonly cause?: unknown;
  readonly message: string;
  readonly reason: "conflict" | "invalid-input" | "not-found" | "storage";
}> {}

export interface MailboxDraftEditing {
  readonly create: (
    command: CreateMailboxDraftCommand
  ) => Effect.Effect<
    DraftEditorDraft,
    MailAuthorizationError | MailboxDraftEditingError,
    CurrentPrincipal
  >;
  readonly get: (
    query: GetMailboxDraftQuery
  ) => Effect.Effect<
    DraftEditorDraft,
    MailAuthorizationError | MailboxDraftEditingError,
    CurrentPrincipal
  >;
  readonly update: (
    command: UpdateMailboxDraftCommand
  ) => Effect.Effect<
    DraftEditorDraft,
    MailAuthorizationError | MailboxDraftEditingError,
    CurrentPrincipal
  >;
}

export const MailboxDraftEditing = Context.Service<MailboxDraftEditing>(
  "cloudflare-inbox/MailboxDraftEditing"
);

const editingError = (
  reason: MailboxDraftEditingError["reason"],
  cause?: unknown
) =>
  new MailboxDraftEditingError({
    cause,
    message:
      reason === "conflict"
        ? "Draft changed"
        : reason === "invalid-input"
          ? "Draft content is invalid"
          : reason === "not-found"
            ? "Draft was not found"
            : "Draft could not be saved",
    reason,
  });

const mapRepositoryError = (
  error: MailboxDomainError | MailboxRepositoryError
) => {
  if (!(error instanceof MailboxDomainError)) {
    return editingError("storage", error);
  }
  if (error.reason === "not-found") {
    return editingError("not-found");
  }
  if (error.reason === "validation") {
    return editingError("invalid-input");
  }
  return error.reason === "version-conflict" ||
    error.reason === "idempotency-conflict"
    ? editingError("conflict")
    : editingError("storage", error);
};

const projectDraft = (draft: DraftType) =>
  Schema.decodeUnknownEffect(DraftEditorDraft)({
    id: draft.id,
    mailboxId: draft.mailboxId,
    content: {
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      textBody: draft.textBody,
    },
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    version: draft.version,
  }).pipe(Effect.mapError((cause) => editingError("storage", cause)));

const verifyIdentity = (
  draft: DraftType,
  mailboxId: MailboxId,
  draftId?: DraftId
) =>
  draft.mailboxId === mailboxId &&
  (draftId === undefined || draft.id === draftId)
    ? Effect.succeed(draft)
    : Effect.fail(
        editingError(
          "storage",
          new Error("Draft editing identity invariant failed")
        )
      );

export const MailboxDraftEditingLive = Layer.effect(
  MailboxDraftEditing,
  Effect.gen(function* () {
    const authorization = yield* MailAuthorization;
    const repository = yield* MailboxRepository;
    const requireEdit = (mailboxId: MailboxId, draftId: DraftId) =>
      authorization
        .requireDraftCreate({ resource: { _tag: "Mailbox", mailboxId } })
        .pipe(
          Effect.andThen(
            authorization.requireDraft({
              action: "edit",
              resource: { _tag: "Draft", draftId, mailboxId },
            })
          )
        );

    return MailboxDraftEditing.of({
      create: (command) =>
        Effect.gen(function* () {
          yield* authorization.requireDraftCreate({
            resource: { _tag: "Mailbox", mailboxId: command.mailboxId },
          });
          const draft = yield* repository
            .createDraft({
              mailboxId: command.mailboxId,
              operationId: command.operationId,
              content: {
                ...command.content,
                attachmentIds: [],
              },
            })
            .pipe(Effect.mapError(mapRepositoryError));
          return yield* verifyIdentity(draft, command.mailboxId).pipe(
            Effect.flatMap(projectDraft)
          );
        }),
      get: (query) =>
        Effect.gen(function* () {
          yield* requireEdit(query.mailboxId, query.draftId);
          const draft = yield* repository
            .getDraft(query)
            .pipe(Effect.mapError(mapRepositoryError));
          return yield* verifyIdentity(
            draft,
            query.mailboxId,
            query.draftId
          ).pipe(Effect.flatMap(projectDraft));
        }),
      update: (command) =>
        Effect.gen(function* () {
          yield* requireEdit(command.mailboxId, command.draftId);
          const existing = yield* repository
            .getDraft({
              draftId: command.draftId,
              mailboxId: command.mailboxId,
            })
            .pipe(Effect.mapError(mapRepositoryError));
          yield* verifyIdentity(existing, command.mailboxId, command.draftId);
          const draft = yield* repository
            .updateDraft({
              draftId: command.draftId,
              mailboxId: command.mailboxId,
              operationId: command.operationId,
              expectedVersion: command.expectedVersion,
              content: {
                ...command.content,
                threadId: existing.threadId,
                inReplyToMessageId: existing.inReplyToMessageId,
                htmlBody: existing.htmlBody,
                attachmentIds: existing.attachmentIds,
              },
            })
            .pipe(Effect.mapError(mapRepositoryError));
          return yield* verifyIdentity(
            draft,
            command.mailboxId,
            command.draftId
          ).pipe(Effect.flatMap(projectDraft));
        }),
    });
  })
);
