import * as Data from "effect/Data";

import type { UnixMillis } from "../primitives";

export class DeliveryTemporaryFailureError extends Data.TaggedError(
  "DeliveryTemporaryFailureError"
)<{
  readonly message: string;
  readonly retryAt?: UnixMillis;
  readonly cause: unknown;
}> {}
