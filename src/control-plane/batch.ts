import type { D1EffectQbResult } from "@effect-auth/core/EffectQbSqliteStorage";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ControlPlaneBatchError } from "../mailboxes/control-plane-batch-error";

export interface ControlPlaneStatement {
  readonly params?: readonly unknown[];
  readonly sql: string;
}

export interface ControlPlaneBatch {
  readonly execute: (
    statements: readonly ControlPlaneStatement[]
  ) => Effect.Effect<readonly D1EffectQbResult[], ControlPlaneBatchError>;
}

/** Atomic multi-statement writes unavailable through the Effect D1 driver. */
export const ControlPlaneBatch = Context.Service<ControlPlaneBatch>(
  "cloudflare-inbox/ControlPlaneBatch"
);
