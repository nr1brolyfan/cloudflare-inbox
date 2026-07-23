import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import { MailboxIdentity } from "#/modules/mailbox/ports/MailboxIdentity";

/** Canonical identity derived from the Durable Object's addressed name. */
export const MailboxIdentityDoLayer = Layer.effect(
  MailboxIdentity,
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    const name = yield* Effect.sync(() => {
      if (state.id.name === undefined) {
        throw new Error(
          "MailboxDO must be addressed by canonical mailbox name"
        );
      }
      return state.id.name;
    });
    const mailboxId = yield* Schema.decodeUnknownEffect(MailboxId)(name).pipe(
      Effect.orDie
    );
    return MailboxIdentity.of({ mailboxId });
  })
);
