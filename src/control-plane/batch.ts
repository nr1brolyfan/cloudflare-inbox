import type { D1EffectQbResult } from "@effect-auth/core/EffectQbSqliteStorage";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

export type ControlPlaneCommitState = "not-committed" | "committed" | "unknown";

export class ControlPlaneBatchError extends Data.TaggedError(
  "ControlPlaneBatchError"
)<{
  readonly cause: unknown;
  readonly commitState: ControlPlaneCommitState;
  readonly statement?: number;
}> {}

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
