/* oxlint-disable max-classes-per-file -- Enrollment models, remediation result, error, and port form one boundary. */
import {
  ChallengeIdSchema,
  UnixMillisSchema,
} from "@effect-auth/core/Identifiers";
import type * as AuthPermission from "@effect-auth/core/Permission";
import type { IssuedSession } from "@effect-auth/core/Sessions";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { CurrentRequestAuth } from "#/modules/account-security/ports/CurrentRequestAuth";
import type { BackendRequestContext } from "#/shared/BackendRequestContext";
import { AdministrativeOperationId } from "#/shared/Operation";

import type { AccountSecurityCommitState } from "./AccountSecurityCommitState";
import { RecoveryCodeText } from "./RecoveryCodeAdministration";

export const PasskeyClientCredential = Schema.Struct({
  authenticatorAttachment: Schema.optional(Schema.String),
  clientExtensionResults: Schema.optional(
    Schema.Record(Schema.String, Schema.Unknown)
  ),
  id: Schema.String,
  rawId: Schema.optional(Schema.String),
  response: Schema.Record(Schema.String, Schema.Unknown),
  type: Schema.Literal("public-key"),
});

export const StartPasskeyEnrollmentCommand = Schema.Struct({});
export const FinishPasskeyEnrollmentCommand = Schema.Struct({
  challengeId: ChallengeIdSchema,
  credential: PasskeyClientCredential,
});

export const PasskeyEnrollmentChallengeMetadata = Schema.Struct({
  authorization: Schema.Literals(["recovery-remediation", "step-up"]),
  operationId: AdministrativeOperationId,
  purpose: Schema.Literal("passkey-enrollment"),
  recoveryIdentityId: Schema.String,
  recoveryIdentityVersion: Schema.Int,
  sessionId: Schema.String,
  sessionSecretHash: Schema.String,
  stepUpPolicyId: Schema.Literal("control-plane-sensitive"),
  stepUpPolicyVersion: Schema.Literal(1),
});

export const StartedPasskeyEnrollment = Schema.Struct({
  challengeId: ChallengeIdSchema,
  expiresAt: UnixMillisSchema,
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
export const EnrolledPasskeyCredential = Schema.Struct({
  credentialId: Schema.String,
});

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
  credentialId: Schema.String,
  generatedAt: UnixMillisSchema,
  type: Schema.Literal("recovery-remediation-completed"),
}) {}

export interface PasskeyEnrollmentResult {
  readonly credentialId: string;
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
    AuthPermission.CurrentPrincipal | BackendRequestContext | CurrentRequestAuth
  >;
  readonly finish: (
    command: Schema.Schema.Type<typeof FinishPasskeyEnrollmentCommand>
  ) => Effect.Effect<
    PasskeyEnrollmentResult,
    PasskeyEnrollmentError,
    AuthPermission.CurrentPrincipal | BackendRequestContext | CurrentRequestAuth
  >;
}

export class PasskeyEnrollment extends Context.Service<
  PasskeyEnrollment,
  PasskeyEnrollmentShape
>()("cloudflare-inbox/PasskeyEnrollment") {}
