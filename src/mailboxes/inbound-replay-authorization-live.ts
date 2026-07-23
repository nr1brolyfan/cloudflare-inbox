import type * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { MailboxId } from "#/modules/mailbox/domain/Mailbox";

import type { MailAuthorizationError } from "../authorization/mail-authorization";
import { MailAuthorization } from "../authorization/mail-authorization";

export interface InboundReplayAuthorization {
  readonly require: (
    mailboxId: MailboxId
  ) => Effect.Effect<
    void,
    MailAuthorizationError,
    AuthPermission.CurrentPrincipal
  >;
}

export const InboundReplayAuthorization =
  Context.Service<InboundReplayAuthorization>(
    "cloudflare-inbox/InboundReplayAuthorization"
  );

export const InboundReplayAuthorizationLive = Layer.effect(
  InboundReplayAuthorization,
  Effect.gen(function* () {
    const authorization = yield* MailAuthorization;
    return InboundReplayAuthorization.of({
      require: (mailboxId) =>
        authorization
          .requireMailbox({
            action: "modify",
            resource: { _tag: "Mailbox", mailboxId },
          })
          .pipe(Effect.asVoid),
    });
  })
);
