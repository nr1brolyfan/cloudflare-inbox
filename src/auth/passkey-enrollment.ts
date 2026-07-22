import {
  ChallengeIdSchema,
  UnixMillisSchema,
} from "@effect-auth/core/Identifiers";
import type * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ControlPlaneCommitState } from "../control-plane/batch";
import { AdministrativeOperationId } from "../mailboxes/core";
import type { BackendRequestContext } from "../observability/request-context";
import type { CurrentRequestAuthShape } from "./session";

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
  operationId: AdministrativeOperationId,
  purpose: Schema.Literal("passkey-enrollment"),
  recoveryIdentityId: Schema.String,
  recoveryIdentityVersion: Schema.Int,
  sessionId: Schema.String,
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

export class PasskeyEnrollmentError extends Data.TaggedError(
  "PasskeyEnrollmentError"
)<{
  readonly cause?: unknown;
  readonly commitState?: ControlPlaneCommitState;
  readonly operation: "finish" | "start";
  readonly reason:
    | "challenge-invalid"
    | "credential-conflict"
    | "invalid-input"
    | "rate-limited"
    | "recovery-identity-required"
    | "restricted-session"
    | "step-up-required"
    | "storage"
    | "verification-failed";
}> {}

export interface PasskeyEnrollment {
  readonly start: (
    command: Schema.Schema.Type<typeof StartPasskeyEnrollmentCommand>
  ) => Effect.Effect<
    Schema.Schema.Type<typeof StartedPasskeyEnrollment>,
    PasskeyEnrollmentError,
    | AuthPermission.CurrentPrincipal
    | BackendRequestContext
    | CurrentRequestAuthShape
  >;
  readonly finish: (
    command: Schema.Schema.Type<typeof FinishPasskeyEnrollmentCommand>
  ) => Effect.Effect<
    Schema.Schema.Type<typeof EnrolledPasskeyCredential>,
    PasskeyEnrollmentError,
    | AuthPermission.CurrentPrincipal
    | BackendRequestContext
    | CurrentRequestAuthShape
  >;
}

export const PasskeyEnrollment = Context.Service<PasskeyEnrollment>(
  "cloudflare-inbox/PasskeyEnrollment"
);
