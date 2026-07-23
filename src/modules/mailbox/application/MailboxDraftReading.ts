/* oxlint-disable max-classes-per-file -- Draft list contract, error and service form one cohesive use case. */
import type { CurrentPrincipal } from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  DraftPage,
  ListDraftsInput,
} from "#/modules/mailbox/domain/MailboxDraft";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import { MailboxAuthorization } from "#/modules/mailbox/ports/MailboxAuthorization";
import type { MailboxAuthorizationError } from "#/modules/mailbox/ports/MailboxAuthorization";
import { MailboxDraftRepository } from "#/modules/mailbox/ports/MailboxDraftRepository";
import type { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";

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

export interface MailboxDraftReadingService {
  readonly list: (
    input: MailboxDraftListInput
  ) => Effect.Effect<
    MailboxDraftListResult,
    MailboxAuthorizationError | MailboxDraftReadingError,
    CurrentPrincipal
  >;
}

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
export class MailboxDraftReading extends Context.Service<
  MailboxDraftReading,
  MailboxDraftReadingService
>()("cloudflare-inbox/MailboxDraftReading", {
  make: Effect.gen(function* () {
    const authorization = yield* MailboxAuthorization;
    const repository = yield* MailboxDraftRepository;

    return {
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
    } satisfies MailboxDraftReadingService;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
