import * as Layer from "effect/Layer";

import { SensitiveOperationStepUpClock } from "#/modules/account-security/ports/SensitiveOperationStepUpClock";

export const SensitiveOperationStepUpClockCloudflareLayer = Layer.succeed(
  SensitiveOperationStepUpClock,
  SensitiveOperationStepUpClock.of({ now: Date.now })
);
