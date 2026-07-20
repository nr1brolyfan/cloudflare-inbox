import * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { MailboxId } from "../mailboxes/core";
import { AiToolAudit, AiToolAuditEvent } from "./tool-audit";
import {
  AiToolArguments,
  AiToolCall,
  AiToolProtocolError,
  AiToolRunId,
} from "./tool-protocol";
import type { AiToolExecutionError, AiToolResult } from "./tool-protocol";

export const CurrentAiToolScopeSchema = Schema.Struct({
  mailboxId: MailboxId,
  runId: AiToolRunId,
  source: Schema.Literal("interactive-session"),
});
export type CurrentAiToolScope = Schema.Schema.Type<
  typeof CurrentAiToolScopeSchema
>;

/** Trusted request scope supplied by the interactive-session boundary, never by the model. */
export const CurrentAiToolScope = Context.Service<CurrentAiToolScope>(
  "cloudflare-inbox/CurrentAiToolScope"
);

export interface AiToolExecutor {
  readonly execute: (
    call: AiToolCall
  ) => Effect.Effect<
    AiToolResult,
    AiToolExecutionError | AiToolProtocolError,
    AuthPermission.CurrentPrincipal | CurrentAiToolScope
  >;
}

export const AiToolExecutor = Context.Service<AiToolExecutor>(
  "cloudflare-inbox/AiToolExecutor"
);

/** Foundation toolset has no names or handlers and therefore fails closed. */
export const AiToolExecutorFoundationLive = Layer.effect(
  AiToolExecutor,
  Effect.gen(function* () {
    const audit = yield* AiToolAudit;

    return AiToolExecutor.of({
      execute: (untrustedCall) =>
        Effect.gen(function* () {
          yield* AuthPermission.CurrentPrincipal;
          const scope = yield* CurrentAiToolScope;
          yield* Schema.decodeUnknownEffect(AiToolArguments)(
            untrustedCall.arguments
          ).pipe(
            Effect.mapError(
              () =>
                new AiToolProtocolError({
                  message: "AI tool arguments are not permitted",
                  reason: "forbidden-arguments",
                })
            )
          );
          const call = yield* Schema.decodeUnknownEffect(AiToolCall)(
            untrustedCall
          ).pipe(
            Effect.mapError(
              () =>
                new AiToolProtocolError({
                  message: "AI tool call is outside the protocol contract",
                  reason: "invalid-call",
                })
            )
          );

          yield* audit.record(
            new AiToolAuditEvent({
              callId: call.callId,
              mailboxId: scope.mailboxId,
              name: call.name,
              outcome: "rejected",
              runId: scope.runId,
              source: scope.source,
            })
          );

          return yield* Effect.fail(
            new AiToolProtocolError({
              callId: call.callId,
              message: "AI tool is not available",
              reason: "unknown-tool",
            })
          );
        }),
    });
  })
);
