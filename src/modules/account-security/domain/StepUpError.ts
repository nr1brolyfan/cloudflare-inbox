import * as Data from "effect/Data";

import type { SensitiveOperationStepUpPolicy } from "./StepUpPolicy";

export class SensitiveOperationStepUpRequired extends Data.TaggedError(
  "SensitiveOperationStepUpRequired"
)<{
  readonly policy: SensitiveOperationStepUpPolicy;
}> {}
