/* oxlint-disable max-classes-per-file -- Result, error and service form one cohesive use case. */
import type { CurrentPrincipal } from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { MailAuthorizationError } from "#/authorization/mail-authorization";
import { MailAuthorization } from "#/authorization/mail-authorization";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import {
  GetOutboundDeliveryInput,
  OutboundDeliverySchema,
} from "#/modules/mailbox/domain/MailboxOutbound";
import { MailboxOutboundDeliveryReadingClock } from "#/modules/mailbox/ports/MailboxOutboundDeliveryReadingClock";
import { MailboxOutboundDeliveryRepository } from "#/modules/mailbox/ports/MailboxOutboundDeliveryRepository";
import type { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";
import { UnixMillis } from "#/shared/Temporal";

export const GetMailboxOutboundDeliveryQuery = GetOutboundDeliveryInput;
export type GetMailboxOutboundDeliveryQuery = Schema.Schema.Type<
  typeof GetMailboxOutboundDeliveryQuery
>;

export const GetMailboxOutboundDeliveryResult = Schema.Struct({
  delivery: OutboundDeliverySchema,
  serverNow: UnixMillis,
});
export type GetMailboxOutboundDeliveryResult = Schema.Schema.Type<
  typeof GetMailboxOutboundDeliveryResult
>;

export class MailboxOutboundDeliveryReadingError extends Data.TaggedError(
  "MailboxOutboundDeliveryReadingError"
)<{
  readonly cause?: unknown;
  readonly message: string;
  readonly reason: "not-found" | "storage";
}> {}

export interface MailboxOutboundDeliveryReadingService {
  readonly get: (
    query: GetMailboxOutboundDeliveryQuery
  ) => Effect.Effect<
    GetMailboxOutboundDeliveryResult,
    MailAuthorizationError | MailboxOutboundDeliveryReadingError,
    CurrentPrincipal
  >;
}

const readingError = (
  reason: MailboxOutboundDeliveryReadingError["reason"],
  cause?: unknown
) =>
  new MailboxOutboundDeliveryReadingError({
    cause,
    message:
      reason === "not-found"
        ? "Outbound delivery was not found"
        : "Outbound delivery could not be loaded",
    reason,
  });

const mapRepositoryError = (
  error: MailboxDomainError | MailboxRepositoryError
) =>
  error instanceof MailboxDomainError && error.reason === "not-found"
    ? readingError("not-found")
    : readingError("storage", error);

export class MailboxOutboundDeliveryReading extends Context.Service<
  MailboxOutboundDeliveryReading,
  MailboxOutboundDeliveryReadingService
>()("cloudflare-inbox/MailboxOutboundDeliveryReading", {
  make: Effect.gen(function* () {
    const authorization = yield* MailAuthorization;
    const clock = yield* MailboxOutboundDeliveryReadingClock;
    const repository = yield* MailboxOutboundDeliveryRepository;

    return {
      get: (query) =>
        Effect.gen(function* () {
          yield* authorization.requireMailboxDraftSend({
            resource: { _tag: "Mailbox", mailboxId: query.mailboxId },
          });
          const delivery = yield* repository
            .getOutboundDelivery(query)
            .pipe(Effect.mapError(mapRepositoryError));
          if (
            delivery.mailboxId !== query.mailboxId ||
            delivery.id !== query.outboundDeliveryId
          ) {
            return yield* readingError(
              "storage",
              new Error("Outbound delivery identity invariant failed")
            );
          }
          const serverNow = yield* Schema.decodeUnknownEffect(UnixMillis)(
            clock.now()
          ).pipe(Effect.mapError((cause) => readingError("storage", cause)));
          return { delivery, serverNow };
        }),
    } satisfies MailboxOutboundDeliveryReadingService;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
