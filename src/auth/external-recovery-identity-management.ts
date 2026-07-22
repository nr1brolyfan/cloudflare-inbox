import { ChallengeIdSchema } from "@effect-auth/core/Identifiers";
import type { ChallengeId, UserIdSchema } from "@effect-auth/core/Identifiers";
import type * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import type { ControlPlaneCommitState } from "../control-plane/batch";
import {
  AdministrativeOperationId,
  EmailAddress,
  Version,
} from "../mailboxes/core";
import type { BackendRequestContext } from "../observability/request-context";
import type { ExternalRecoveryIdentitySchema } from "./external-recovery-identity";
import type { CurrentRequestAuthShape } from "./session";

export const ExternalRecoveryChallengeSecret = Schema.String.pipe(
  Schema.check(Schema.isLengthBetween(32, 256)),
  Schema.brand("cloudflare-inbox/ExternalRecoveryChallengeSecret")
);
export type ExternalRecoveryChallengeSecret = Schema.Schema.Type<
  typeof ExternalRecoveryChallengeSecret
>;

export const EnrollExternalRecoveryIdentityCommand = Schema.Struct({
  address: EmailAddress,
  operationId: AdministrativeOperationId,
});
export type EnrollExternalRecoveryIdentityCommand = Schema.Schema.Type<
  typeof EnrollExternalRecoveryIdentityCommand
>;

export const VerifyExternalRecoveryIdentityCommand = Schema.Struct({
  challengeId: ChallengeIdSchema,
  expectedVersion: Version,
  operationId: AdministrativeOperationId,
  secret: ExternalRecoveryChallengeSecret,
});
export type VerifyExternalRecoveryIdentityCommand = Schema.Schema.Type<
  typeof VerifyExternalRecoveryIdentityCommand
>;

export type ExternalRecoveryIdentityManagementOperation = "enroll" | "verify";
export type ExternalRecoveryIdentityManagementReason =
  | "challenge-invalid"
  | "delivery"
  | "invalid-input"
  | "policy-denied"
  | "restricted-session"
  | "step-up-required"
  | "storage"
  | "version-conflict";

export class ExternalRecoveryIdentityManagementError extends Data.TaggedError(
  "ExternalRecoveryIdentityManagementError"
)<{
  readonly cause?: unknown;
  readonly commitState?: ControlPlaneCommitState;
  readonly operation: ExternalRecoveryIdentityManagementOperation;
  readonly reason: ExternalRecoveryIdentityManagementReason;
}> {}

export interface ExternalRecoveryIdentityManagement {
  readonly enroll: (
    command: EnrollExternalRecoveryIdentityCommand
  ) => Effect.Effect<
    Schema.Schema.Type<typeof ExternalRecoveryIdentitySchema>,
    ExternalRecoveryIdentityManagementError,
    | AuthPermission.CurrentPrincipal
    | BackendRequestContext
    | CurrentRequestAuthShape
  >;
  readonly verify: (
    command: VerifyExternalRecoveryIdentityCommand
  ) => Effect.Effect<
    Schema.Schema.Type<typeof ExternalRecoveryIdentitySchema>,
    ExternalRecoveryIdentityManagementError,
    | AuthPermission.CurrentPrincipal
    | BackendRequestContext
    | CurrentRequestAuthShape
  >;
}

/** Authenticated recovery-only lifecycle; it never creates login identities. */
export const ExternalRecoveryIdentityManagement =
  Context.Service<ExternalRecoveryIdentityManagement>(
    "cloudflare-inbox/ExternalRecoveryIdentityManagement"
  );

export interface IssuedExternalRecoveryChallenge {
  readonly challengeId: ChallengeId;
  readonly expiresAt: number;
  readonly secret: Redacted.Redacted<ExternalRecoveryChallengeSecret>;
}

export interface ExternalRecoveryIdentityChallenge {
  readonly consume: (challengeId: ChallengeId) => Effect.Effect<void>;
  readonly inspect: (input: {
    readonly challengeId: ChallengeId;
    readonly identityId: string;
    readonly secret: ExternalRecoveryChallengeSecret;
    readonly userId: Schema.Schema.Type<typeof UserIdSchema>;
  }) => Effect.Effect<void, ExternalRecoveryIdentityManagementError>;
  readonly issue: (input: {
    readonly identityId: string;
    readonly userId: Schema.Schema.Type<typeof UserIdSchema>;
  }) => Effect.Effect<
    IssuedExternalRecoveryChallenge,
    ExternalRecoveryIdentityManagementError
  >;
}

export const ExternalRecoveryIdentityChallenge =
  Context.Service<ExternalRecoveryIdentityChallenge>(
    "cloudflare-inbox/ExternalRecoveryIdentityChallenge"
  );

export interface ExternalRecoveryIdentityDelivery {
  readonly sendVerification: (input: {
    readonly address: EmailAddress;
    readonly challenge: IssuedExternalRecoveryChallenge;
  }) => Effect.Effect<void, ExternalRecoveryIdentityManagementError>;
}

export const ExternalRecoveryIdentityDelivery =
  Context.Service<ExternalRecoveryIdentityDelivery>(
    "cloudflare-inbox/ExternalRecoveryIdentityDelivery"
  );
