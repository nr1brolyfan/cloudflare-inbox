import * as Data from "effect/Data";

export type ControlPlaneCommitState = "not-committed" | "committed" | "unknown";

export class ControlPlaneBatchError extends Data.TaggedError(
  "ControlPlaneBatchError"
)<{
  readonly cause: unknown;
  readonly commitState: ControlPlaneCommitState;
  readonly statement?: number;
}> {}
