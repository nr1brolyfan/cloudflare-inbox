/* oxlint-disable max-classes-per-file -- Replay coordination and authorization form one use case. */
import type * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { MailAuthorizationError } from "#/authorization/mail-authorization";
import { MailAuthorization } from "#/authorization/mail-authorization";
import type { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import type { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import type {
  InboundProcessingResult,
  ReplayInboundInput,
} from "#/modules/mailbox/domain/MailboxInbound";
import { InboundWorkflowStarter } from "#/modules/mailbox/ports/InboundWorkflowStarter";
import { InboundReplayPreparer } from "#/modules/mailbox/ports/MailboxInboundRepository";
import type { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";
import type { WorkflowStartError } from "#/modules/mailbox/ports/MailboxWorkflowStarter";

export interface MailboxInboundReplayService {
  readonly replay: (
    input: ReplayInboundInput
  ) => Effect.Effect<
    InboundProcessingResult,
    MailboxDomainError | MailboxRepositoryError | WorkflowStartError
  >;
}

export class MailboxInboundReplay extends Context.Service<
  MailboxInboundReplay,
  MailboxInboundReplayService
>()("cloudflare-inbox/InboundReplay", {
  make: Effect.gen(function* () {
    const preparer = yield* InboundReplayPreparer;
    const starter = yield* InboundWorkflowStarter;
    return {
      replay: (input) =>
        preparer.claim(input).pipe(
          Effect.tap((prepared) => starter.start(prepared.workflow)),
          Effect.map((prepared) => prepared.processing)
        ),
    } satisfies MailboxInboundReplayService;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}

export interface MailboxInboundReplayAuthorizationService {
  readonly require: (
    mailboxId: MailboxId
  ) => Effect.Effect<
    void,
    MailAuthorizationError,
    AuthPermission.CurrentPrincipal
  >;
}

export class MailboxInboundReplayAuthorization extends Context.Service<
  MailboxInboundReplayAuthorization,
  MailboxInboundReplayAuthorizationService
>()("cloudflare-inbox/InboundReplayAuthorization", {
  make: Effect.gen(function* () {
    const authorization = yield* MailAuthorization;
    return {
      require: (mailboxId) =>
        authorization
          .requireMailbox({
            action: "modify",
            resource: { _tag: "Mailbox", mailboxId },
          })
          .pipe(Effect.asVoid),
    } satisfies MailboxInboundReplayAuthorizationService;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
