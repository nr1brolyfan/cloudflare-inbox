import * as Data from "effect/Data";

export class AdministrativeAuditError extends Data.TaggedError(
  "AdministrativeAuditError"
)<{
  readonly cause: unknown;
  readonly reason: "digest" | "invalid-context" | "invalid-event";
}> {}
