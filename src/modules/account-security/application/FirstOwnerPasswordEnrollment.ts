/* oxlint-disable max-classes-per-file -- The command, receipt, result, error, and service form one enrollment boundary. */
import { defaultPasswordMaxBytes } from "@effect-auth/core/Password";
import type * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { PasswordPolicySchema } from "#/modules/account-security/domain/PasswordPolicy";
import { FirstOwnerPasswordEnrollmentTransaction } from "#/modules/account-security/ports/FirstOwnerPasswordEnrollmentTransaction";
import { AdministrativeOperationId } from "#/shared/Operation";
import type { CurrentRequestAuth } from "#/shared/RequestAuth";
import { UnixMillis } from "#/shared/Temporal";

const textEncoder = new TextEncoder();

export const FirstOwnerPassword = PasswordPolicySchema.pipe(
  Schema.check(
    Schema.makeFilter((password) =>
      textEncoder.encode(password).byteLength <= defaultPasswordMaxBytes
        ? undefined
        : "Password exceeds the supported UTF-8 byte length"
    )
  )
);

export const EnrollFirstOwnerPasswordCommand = Schema.Struct({
  email: Schema.optional(Schema.Never),
  mailboxId: Schema.optional(Schema.Never),
  operationId: AdministrativeOperationId,
  organizationId: Schema.optional(Schema.Never),
  password: FirstOwnerPassword,
  userId: Schema.optional(Schema.Never),
});
export type EnrollFirstOwnerPasswordCommand = Schema.Schema.Type<
  typeof EnrollFirstOwnerPasswordCommand
>;

export class FirstOwnerPasswordEnrollmentReceipt extends Schema.Class<FirstOwnerPasswordEnrollmentReceipt>(
  "cloudflare-inbox/FirstOwnerPasswordEnrollmentReceipt"
)({
  committedAt: UnixMillis,
  operationId: AdministrativeOperationId,
  schemaVersion: Schema.Literal(1),
}) {}

export class FirstOwnerPasswordEnrolled extends Schema.Class<FirstOwnerPasswordEnrolled>(
  "cloudflare-inbox/FirstOwnerPasswordEnrolled"
)({
  _tag: Schema.Literal("FirstOwnerPasswordEnrolled"),
  receipt: FirstOwnerPasswordEnrollmentReceipt,
}) {}

export class FirstOwnerPasswordAlreadyEnrolled extends Schema.Class<FirstOwnerPasswordAlreadyEnrolled>(
  "cloudflare-inbox/FirstOwnerPasswordAlreadyEnrolled"
)({
  _tag: Schema.Literal("FirstOwnerPasswordAlreadyEnrolled"),
  receipt: FirstOwnerPasswordEnrollmentReceipt,
}) {}

export const FirstOwnerPasswordEnrollmentResult = Schema.Union([
  FirstOwnerPasswordEnrolled,
  FirstOwnerPasswordAlreadyEnrolled,
]);
export type FirstOwnerPasswordEnrollmentResult = Schema.Schema.Type<
  typeof FirstOwnerPasswordEnrollmentResult
>;

export class FirstOwnerPasswordEnrollmentError extends Data.TaggedError(
  "FirstOwnerPasswordEnrollmentError"
)<{
  readonly cause?: unknown;
  readonly commitState?: "committed" | "not-committed" | "unknown";
  readonly reason:
    | "deployment-not-empty"
    | "indeterminate"
    | "invalid-input"
    | "operation-conflict"
    | "owner-config-invalid"
    | "owner-not-eligible"
    | "proof-required"
    | "rate-limited"
    | "restricted-session"
    | "state-conflict"
    | "storage";
}> {}

export interface FirstOwnerPasswordEnrollmentService {
  readonly enroll: (
    command: EnrollFirstOwnerPasswordCommand
  ) => Effect.Effect<
    FirstOwnerPasswordEnrollmentResult,
    FirstOwnerPasswordEnrollmentError,
    AuthPermission.CurrentPrincipal | CurrentRequestAuth
  >;
}

export class FirstOwnerPasswordEnrollment extends Context.Service<
  FirstOwnerPasswordEnrollment,
  FirstOwnerPasswordEnrollmentService
>()("cloudflare-inbox/FirstOwnerPasswordEnrollment", {
  make: Effect.gen(function* () {
    return yield* FirstOwnerPasswordEnrollmentTransaction;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);

  static readonly mockLayer = Layer.mock(this, {
    enroll: () => Effect.die("Unexpected first-owner password enrollment"),
  });
}
