import * as Data from "effect/Data";

import type { SensitiveOperationStepUpPolicy } from "./step-up-policy";

export class SensitiveOperationStepUpRequired extends Data.TaggedError(
  "SensitiveOperationStepUpRequired"
)<{
  readonly policy: SensitiveOperationStepUpPolicy;
}> {}
