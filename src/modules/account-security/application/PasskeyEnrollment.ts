/* oxlint-disable max-classes-per-file -- Enrollment models, remediation result, error, and port form one boundary. */
import {
  ChallengeIdSchema,
  UnixMillisSchema,
} from "@effect-auth/core/Identifiers";
import { PasskeyRegistrationCredentialPayload } from "@effect-auth/core/PasskeyCredentialPayload";
import type * as AuthPermission from "@effect-auth/core/Permission";
import type { IssuedSession } from "@effect-auth/core/Sessions";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { PasskeyEnrollmentTransaction } from "#/modules/account-security/ports/PasskeyEnrollmentTransaction";
import { AdministrativeOperationId } from "#/shared/Operation";
import type { CurrentRequestAuth } from "#/shared/RequestAuth";
import type { RequestCorrelation } from "#/shared/RequestCorrelation";

import type { AccountSecurityCommitState } from "./AccountSecurityCommitState";
import { RecoveryCodeText } from "./RecoveryCodeAdministration";

export const PasskeyEnrollmentReadbackSecret = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/u)),
  Schema.brand("cloudflare-inbox/PasskeyEnrollmentReadbackSecret")
);
export const StartPasskeyEnrollmentCommand = Schema.Struct({
  operationId: AdministrativeOperationId,
  readbackSecret: Schema.optional(PasskeyEnrollmentReadbackSecret),
});
export const FinishPasskeyEnrollmentCommand = Schema.Struct({
  challengeId: ChallengeIdSchema,
  credential: PasskeyRegistrationCredentialPayload,
  operationId: AdministrativeOperationId,
  readbackSecret: Schema.optional(PasskeyEnrollmentReadbackSecret),
});
export const ReadPasskeyEnrollmentCommand = Schema.Struct({
  challengeId: ChallengeIdSchema,
  credential: PasskeyRegistrationCredentialPayload,
  operationId: AdministrativeOperationId,
});
export const ReadRecoveryPasskeyEnrollmentCommand = Schema.Struct({
  challengeId: ChallengeIdSchema,
  credential: PasskeyRegistrationCredentialPayload,
  operationId: AdministrativeOperationId,
  readbackSecret: PasskeyEnrollmentReadbackSecret,
});

export const PasskeyEnrollmentChallengeMetadata = Schema.Struct({
  authorization: Schema.Literals(["recovery-remediation", "step-up"]),
  operationId: AdministrativeOperationId,
  purpose: Schema.Literal("passkey-enrollment"),
  readbackSecretHash: Schema.optional(Schema.String),
  recoveryIdentityId: Schema.String,
  recoveryIdentityVersion: Schema.Int,
  sessionId: Schema.String,
  sessionSecretHash: Schema.String,
  stepUpPolicyId: Schema.Literal("control-plane-sensitive"),
  stepUpPolicyVersion: Schema.Literal(1),
}).pipe(
  Schema.check(
    Schema.makeFilter((metadata) =>
      metadata.authorization === "step-up"
        ? metadata.readbackSecretHash === undefined
          ? undefined
          : "normal passkey challenge cannot bind a readback secret"
        : metadata.readbackSecretHash === undefined
          ? "recovery passkey challenge requires a readback secret hash"
          : undefined
    )
  )
);

export const StartedPasskeyEnrollment = Schema.Struct({
  challengeId: ChallengeIdSchema,
  expiresAt: UnixMillisSchema,
  operationId: AdministrativeOperationId,
  publicKey: Schema.Struct({
    attestation: Schema.optional(Schema.String),
    authenticatorSelection: Schema.optional(
      Schema.Record(Schema.String, Schema.Unknown)
    ),
    challenge: Schema.String,
    excludeCredentials: Schema.optional(Schema.Array(Schema.Unknown)),
    pubKeyCredParams: Schema.Array(Schema.Unknown),
    rp: Schema.Struct({ id: Schema.String, name: Schema.String }),
    timeout: Schema.optional(Schema.Number),
    user: Schema.Struct({
      displayName: Schema.String,
      id: Schema.String,
      name: Schema.String,
    }),
  }),
});
export const PasskeyEnrollmentMode = Schema.Literals([
  "normal",
  "recovery-remediation",
]);

export class PasskeyEnrollmentReceipt extends Schema.Class<PasskeyEnrollmentReceipt>(
  "cloudflare-inbox/PasskeyEnrollmentReceipt"
)({
  committedAt: UnixMillisSchema,
  credentialRecordId: Schema.String,
  mode: PasskeyEnrollmentMode,
  operationId: AdministrativeOperationId,
  recoveryCodeCount: Schema.optional(Schema.Literal(10)),
  recoveryCodeSetId: Schema.optional(Schema.String),
  schemaVersion: Schema.Literal(1),
}) {}

export const PasskeyEnrollmentReceiptSchema = PasskeyEnrollmentReceipt.check(
  Schema.makeFilter((receipt) => {
    const hasRecoveryResult =
      receipt.recoveryCodeCount !== undefined &&
      receipt.recoveryCodeSetId !== undefined;
    return receipt.mode === "normal"
      ? receipt.recoveryCodeCount === undefined &&
        receipt.recoveryCodeSetId === undefined
        ? undefined
        : "normal receipt cannot contain recovery-code result"
      : hasRecoveryResult && receipt.recoveryCodeCount === 10
        ? undefined
        : "recovery-remediation receipt requires the ten-code result";
  })
);

export class RecoveryPasskeyRemediationCompleted extends Schema.Class<RecoveryPasskeyRemediationCompleted>(
  "cloudflare-inbox/RecoveryPasskeyRemediationCompleted"
)({
  codes: Schema.Array(RecoveryCodeText).pipe(
    Schema.check(
      Schema.makeFilter((codes) =>
        codes.length === 10 ? undefined : "must contain exactly 10 codes"
      )
    )
  ),
  receipt: PasskeyEnrollmentReceiptSchema,
  type: Schema.Literal("recovery-remediation-completed"),
}) {}

export class PasskeyEnrollmentAlreadyCompleted extends Schema.Class<PasskeyEnrollmentAlreadyCompleted>(
  "cloudflare-inbox/PasskeyEnrollmentAlreadyCompleted"
)({
  receipt: PasskeyEnrollmentReceiptSchema,
  type: Schema.Literal("passkey-enrollment-already-completed"),
}) {}

export const RecoveryPasskeyEnrollmentResult = Schema.Union([
  RecoveryPasskeyRemediationCompleted,
  PasskeyEnrollmentAlreadyCompleted,
]);

export interface PasskeyEnrollmentResult {
  readonly receipt: PasskeyEnrollmentReceipt;
  readonly replayed: boolean;
  readonly remediation?: {
    readonly body: RecoveryPasskeyRemediationCompleted;
    readonly session: IssuedSession;
  };
}

export class PasskeyEnrollmentError extends Data.TaggedError(
  "PasskeyEnrollmentError"
)<{
  readonly cause?: unknown;
  readonly commitState?: AccountSecurityCommitState;
  readonly operation: "finish" | "start";
  readonly reason:
    | "challenge-invalid"
    | "credential-conflict"
    | "indeterminate"
    | "invalid-input"
    | "invalid-proof"
    | "operation-conflict"
    | "rate-limited"
    | "recovery-identity-required"
    | "restricted-session"
    | "step-up-required"
    | "storage"
    | "verification-failed";
}> {}

export interface PasskeyEnrollmentShape {
  readonly start: (
    command: Schema.Schema.Type<typeof StartPasskeyEnrollmentCommand>
  ) => Effect.Effect<
    Schema.Schema.Type<typeof StartedPasskeyEnrollment>,
    PasskeyEnrollmentError,
    AuthPermission.CurrentPrincipal | CurrentRequestAuth | RequestCorrelation
  >;
  readonly finish: (
    command: Schema.Schema.Type<typeof FinishPasskeyEnrollmentCommand>
  ) => Effect.Effect<
    PasskeyEnrollmentResult,
    PasskeyEnrollmentError,
    AuthPermission.CurrentPrincipal | CurrentRequestAuth | RequestCorrelation
  >;
  readonly readOperation: (
    command: Schema.Schema.Type<typeof ReadPasskeyEnrollmentCommand>
  ) => Effect.Effect<
    PasskeyEnrollmentReceipt,
    PasskeyEnrollmentError,
    AuthPermission.CurrentPrincipal | CurrentRequestAuth | RequestCorrelation
  >;
  readonly readRecoveryOperation: (
    command: unknown
  ) => Effect.Effect<PasskeyEnrollmentReceipt, PasskeyEnrollmentError>;
}

export class PasskeyEnrollment extends Context.Service<
  PasskeyEnrollment,
  PasskeyEnrollmentShape
>()("cloudflare-inbox/PasskeyEnrollment", {
  make: Effect.gen(function* () {
    return yield* PasskeyEnrollmentTransaction;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
