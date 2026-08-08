import * as Cloudflare from "alchemy/Cloudflare";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  MailboxChangedEvent,
  mailboxChangedEvent,
} from "#/modules/mailbox/domain/MailboxRealtime";
import { MailboxChangePublisher } from "#/modules/mailbox/ports/MailboxChangePublisher";
import { UnixMillis } from "#/shared/Temporal";

export const MailboxSocketAttachment = Schema.Struct({
  formatVersion: Schema.Literal(1),
  leaseExpiresAt: UnixMillis,
});
export type MailboxSocketAttachment = Schema.Schema.Type<
  typeof MailboxSocketAttachment
>;

const decodeAttachment = Schema.decodeUnknownOption(MailboxSocketAttachment);
const encodeEvent = (event: Schema.Schema.Type<typeof MailboxChangedEvent>) =>
  JSON.stringify(Schema.encodeSync(MailboxChangedEvent)(event));

export const MailboxChangePublisherDoLayer = Layer.effect(
  MailboxChangePublisher,
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;

    return MailboxChangePublisher.of({
      publish: (scopes) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const event = encodeEvent(mailboxChangedEvent(scopes));
          yield* Effect.sync(() => {
            for (const socket of state.raw.getWebSockets()) {
              try {
                const attachment = decodeAttachment(
                  socket.deserializeAttachment()
                );
                if (attachment._tag === "None") {
                  socket.close(1008, "Invalid socket session");
                } else if (attachment.value.leaseExpiresAt <= now) {
                  socket.close(1000, "Socket lease expired");
                } else {
                  socket.send(event);
                }
              } catch {
                // A broken peer must not prevent invalidation for other clients.
              }
            }
          });
        }),
    });
  })
);
