import * as Data from "effect/Data";

export class DeliveryIndeterminateError extends Data.TaggedError(
  "DeliveryIndeterminateError"
)<{
  readonly message: string;
  readonly cause: unknown;
}> {}
