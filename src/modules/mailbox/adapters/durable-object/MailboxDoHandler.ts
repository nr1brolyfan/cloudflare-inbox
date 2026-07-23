import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import {
  MailboxResourceLookup,
  MailboxResourceLookupResult,
} from "#/modules/mailbox/domain/MailboxResource";
import {
  DirectoryRpcRequest,
  MailDataRpcRequest,
} from "#/modules/mailbox/ports/MailboxDoProtocol";
import { MailboxDoStore } from "#/modules/mailbox/ports/MailboxDoStore";
import { MailboxIdentity } from "#/modules/mailbox/ports/MailboxIdentity";

/** Rejects a payload that attempts to target a mailbox other than this DO. */
export const validateMailboxDoRequestIdentity = (
  canonicalMailboxId: MailboxId,
  requestedMailboxId: MailboxId
) =>
  canonicalMailboxId === requestedMailboxId
    ? Effect.void
    : Effect.die(
        new Error("MailboxDO request mailboxId does not match its identity")
      );

export interface MailboxDoHandlerService {
  readonly executeDirectory: (input: unknown) => Effect.Effect<unknown>;
  readonly executeMailData: (input: unknown) => Effect.Effect<unknown>;
  readonly resolveMailResource: (input: unknown) => Effect.Effect<unknown>;
}

/** Decodes trusted Durable Object calls and delegates through the store port. */
export class MailboxDoHandler extends Context.Service<
  MailboxDoHandler,
  MailboxDoHandlerService
>()("cloudflare-inbox/MailboxDoHandler") {}

export const MailboxDoHandlerLayer = Layer.effect(
  MailboxDoHandler,
  Effect.gen(function* () {
    const store = yield* MailboxDoStore;
    const { mailboxId } = yield* MailboxIdentity;

    return MailboxDoHandler.of({
      executeDirectory: (input) =>
        Effect.gen(function* () {
          const request =
            yield* Schema.decodeUnknownEffect(DirectoryRpcRequest)(input);
          yield* validateMailboxDoRequestIdentity(
            mailboxId,
            request.input.mailboxId
          );
          return yield* store.executeDirectory(request);
        }).pipe(Effect.orDie),
      executeMailData: (input) =>
        Effect.gen(function* () {
          const request =
            yield* Schema.decodeUnknownEffect(MailDataRpcRequest)(input);
          yield* validateMailboxDoRequestIdentity(
            mailboxId,
            request.input.mailboxId
          );
          return yield* store.executeMailData(request);
        }).pipe(Effect.orDie),
      resolveMailResource: (input) =>
        Effect.gen(function* () {
          const lookup = yield* Schema.decodeUnknownEffect(
            MailboxResourceLookup
          )(input);
          yield* validateMailboxDoRequestIdentity(mailboxId, lookup.mailboxId);
          const result = yield* store.resolveMailResource(lookup);
          return yield* Schema.encodeEffect(MailboxResourceLookupResult)(
            result
          );
        }).pipe(Effect.orDie),
    });
  })
);
