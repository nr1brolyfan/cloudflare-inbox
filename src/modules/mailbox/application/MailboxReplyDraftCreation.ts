/* oxlint-disable max-classes-per-file -- The reply command service and its public error form one use-case contract. */
import type { CurrentPrincipal } from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { DraftEditorDraft } from "#/modules/mailbox/application/MailboxDraftEditing";
import { CreateReplyDraftInput } from "#/modules/mailbox/domain/MailboxDraft";
import type { Draft as DraftType } from "#/modules/mailbox/domain/MailboxDraft";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import { MailboxAuthorization } from "#/modules/mailbox/ports/MailboxAuthorization";
import type { MailboxAuthorizationError } from "#/modules/mailbox/ports/MailboxAuthorization";
import { MailboxReplyDraftRepository } from "#/modules/mailbox/ports/MailboxReplyDraftRepository";
import type { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";

export const CreateMailboxReplyDraftCommand = CreateReplyDraftInput;
export type CreateMailboxReplyDraftCommand = CreateReplyDraftInput;

export class MailboxReplyDraftCreationError extends Data.TaggedError(
  "MailboxReplyDraftCreationError"
)<{
  readonly cause?: unknown;
  readonly message: string;
  readonly reason: "conflict" | "invalid-input" | "not-found" | "storage";
}> {}

const creationError = (
  reason: MailboxReplyDraftCreationError["reason"],
  cause?: unknown
) =>
  new MailboxReplyDraftCreationError({
    cause,
    message:
      reason === "conflict"
        ? "Reply draft operation conflicts with an earlier request"
        : reason === "invalid-input"
          ? "Reply target has too many recipients"
          : reason === "not-found"
            ? "Reply target was not found"
            : "Reply draft could not be created",
    reason,
  });

const mapRepositoryError = (
  error: MailboxDomainError | MailboxRepositoryError
) =>
  error instanceof MailboxDomainError
    ? error.reason === "not-found"
      ? creationError("not-found")
      : error.reason === "validation"
        ? creationError("invalid-input")
        : error.reason === "idempotency-conflict"
          ? creationError("conflict")
          : creationError("storage", error)
    : creationError("storage", error);

const projectDraft = (draft: DraftType) =>
  new DraftEditorDraft({
    id: draft.id,
    mailboxId: draft.mailboxId,
    content: {
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      textBody: draft.textBody,
    },
    attachments: [],
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    version: draft.version,
  });

export interface MailboxReplyDraftCreationService {
  readonly create: (
    command: CreateMailboxReplyDraftCommand
  ) => Effect.Effect<
    DraftEditorDraft,
    MailboxAuthorizationError | MailboxReplyDraftCreationError,
    CurrentPrincipal
  >;
}

export class MailboxReplyDraftCreation extends Context.Service<
  MailboxReplyDraftCreation,
  MailboxReplyDraftCreationService
>()("cloudflare-inbox/MailboxReplyDraftCreation", {
  make: Effect.gen(function* () {
    const authorization = yield* MailboxAuthorization;
    const repository = yield* MailboxReplyDraftRepository;

    return {
      create: (command) =>
        Effect.gen(function* () {
          yield* authorization.requireDraftCreate({
            resource: { _tag: "Mailbox", mailboxId: command.mailboxId },
          });
          const previous = yield* repository
            .readReplyDraftOperation(command)
            .pipe(Effect.mapError(mapRepositoryError));
          if (previous._tag === "Found") {
            const location = yield* authorization.requireDraft({
              action: "edit",
              resource: {
                _tag: "Draft",
                draftId: previous.draft.id,
                mailboxId: command.mailboxId,
              },
            });
            if (
              previous.draft.mailboxId !== command.mailboxId ||
              location.mailboxId !== command.mailboxId ||
              location.draftId !== previous.draft.id
            ) {
              return yield* creationError("storage");
            }
            return projectDraft(previous.draft);
          }
          const readAccess =
            command._tag === "Folder"
              ? yield* authorization.requireFolderMessageRead({
                  resource: {
                    _tag: "Folder",
                    folderId: command.folderId,
                    mailboxId: command.mailboxId,
                  },
                })
              : yield* authorization.requireMailboxMessageRead({
                  resource: {
                    _tag: "Mailbox",
                    mailboxId: command.mailboxId,
                  },
                });
          if (readAccess.mailboxId !== command.mailboxId) {
            return yield* creationError("not-found");
          }
          if (command._tag === "Folder") {
            const location = yield* authorization.requireMessage({
              action: "read",
              resource: {
                _tag: "Message",
                mailboxId: command.mailboxId,
                messageId: command.messageId,
              },
            });
            if (location.folderId !== command.folderId) {
              return yield* creationError("not-found");
            }
          }
          const draft = yield* repository
            .createReplyDraft(command)
            .pipe(Effect.mapError(mapRepositoryError));
          if (draft.mailboxId !== command.mailboxId) {
            return yield* creationError("storage");
          }
          return projectDraft(draft);
        }),
    } satisfies MailboxReplyDraftCreationService;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
