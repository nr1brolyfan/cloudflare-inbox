import * as Data from "effect/Data";

export class RecoverySafeIdentityRejected extends Data.TaggedError(
  "RecoverySafeIdentityRejected"
)<{
  readonly cause?: unknown;
  readonly reason:
    | "login-identity"
    | "mailbox-address"
    | "managed-domain"
    | "recovery-identity"
    | "storage";
}> {}
