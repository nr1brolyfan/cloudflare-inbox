import type { CurrentPrincipal } from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { MailAuthorizationError } from "../authorization/mail-authorization";
import { MailAuthorization } from "../authorization/mail-authorization";
import { DraftPage, ListDraftsInput } from "./drafts";
import { MailboxDomainError } from "./errors";
import type { MailboxRepositoryError } from "./errors";
import { MailboxRepository } from "./repository";

export const MailboxDraftListInput = ListDraftsInput;
export type MailboxDraftListInput = ListDraftsInput;
export const MailboxDraftListResult = DraftPage;
export type MailboxDraftListResult = DraftPage;

export class MailboxDraftReadingError extends Data.TaggedError(
  "MailboxDraftReadingError"
)<{
  readonly cause?: unknown;
  readonly message: string;
  readonly reason: "invalid-input" | "storage";
}> {}

export interface MailboxDraftReading {
  readonly list: (
    input: MailboxDraftListInput
  ) => Effect.Effect<
    MailboxDraftListResult,
    MailAuthorizationError | MailboxDraftReadingError,
    CurrentPrincipal
  >;
}

export const MailboxDraftReading = Context.Service<MailboxDraftReading>(
  "cloudflare-inbox/MailboxDraftReading"
);

const readingError = (
  reason: MailboxDraftReadingError["reason"],
  cause?: unknown
) =>
  new MailboxDraftReadingError({
    cause,
    message:
      reason === "invalid-input"
        ? "Mailbox draft query is invalid"
        : "Mailbox drafts could not be loaded",
    reason,
  });

const mapRepositoryError = (
  error: MailboxDomainError | MailboxRepositoryError
) =>
  error instanceof MailboxDomainError && error.reason === "validation"
    ? readingError("invalid-input")
    : readingError("storage", error);

/** Authorized active-draft collection reads for a mailbox. */
export const MailboxDraftReadingLive = Layer.effect(
  MailboxDraftReading,
  Effect.gen(function* () {
    const authorization = yield* MailAuthorization;
    const repository = yield* MailboxRepository;

    return MailboxDraftReading.of({
      list: (input) =>
        Effect.gen(function* () {
          yield* authorization.requireDraftCreate({
            resource: { _tag: "Mailbox", mailboxId: input.mailboxId },
          });
          const page = yield* repository
            .listDrafts(input)
            .pipe(Effect.mapError(mapRepositoryError));
          if (page.items.some((draft) => draft.mailboxId !== input.mailboxId)) {
            return yield* readingError(
              "storage",
              new Error("Mailbox draft list identity invariant failed")
            );
          }
          return page;
        }),
    });
  })
);
