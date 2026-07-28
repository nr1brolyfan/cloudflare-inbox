/* oxlint-disable max-classes-per-file -- Read error and read port form one persistence boundary. */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

export class StepUpFactorReadError extends Data.TaggedError(
  "StepUpFactorReadError"
)<{ readonly cause: unknown }> {}

export interface StepUpFactorReaderShape {
  readonly passkeyAvailable: (
    userId: string
  ) => Effect.Effect<boolean, StepUpFactorReadError>;
  readonly passwordAvailable: (
    userId: string
  ) => Effect.Effect<boolean, StepUpFactorReadError>;
}

/** Read-only projection used by the step-up options endpoint. */
export class StepUpFactorReader extends Context.Service<
  StepUpFactorReader,
  StepUpFactorReaderShape
>()("cloudflare-inbox/StepUpFactorReader") {}
