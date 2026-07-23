import * as Context from "effect/Context";

export interface SensitiveOperationStepUpClockShape {
  readonly now: () => number;
}

/** Clock used for issuing and evaluating security evidence. */
export class SensitiveOperationStepUpClock extends Context.Service<
  SensitiveOperationStepUpClock,
  SensitiveOperationStepUpClockShape
>()("cloudflare-inbox/SensitiveOperationStepUpClock") {}
