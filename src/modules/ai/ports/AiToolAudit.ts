import type * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

import type { AiToolAuditEvent } from "../domain/AiToolAuditEvent";

export class AiToolAuditError extends Data.TaggedError("AiToolAuditError")<{
  readonly cause: unknown;
  readonly reason: "collision" | "storage";
}> {}

export interface AiToolAudit {
  readonly record: (
    event: AiToolAuditEvent
  ) => Effect.Effect<void, AiToolAuditError, AuthPermission.CurrentPrincipal>;
}

export const AiToolAudit = Context.Service<AiToolAudit>(
  "cloudflare-inbox/AiToolAudit"
);
