/* oxlint-disable max-classes-per-file -- Management error and service form one cohesive use case. */
import { ChallengeIdSchema } from "@effect-auth/core/Identifiers";
import type * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { ExternalRecoveryIdentitySchema } from "#/modules/account-security/domain/ExternalRecoveryIdentity";
import type { CurrentRequestAuth } from "#/modules/account-security/ports/CurrentRequestAuth";
import { ExternalRecoveryIdentityTransaction } from "#/modules/account-security/ports/ExternalRecoveryIdentityTransaction";
import { EmailAddress } from "#/modules/address-routing/domain/EmailAddress";
import { Version } from "#/modules/mailbox/domain/Mailbox";
import type { BackendRequestContext } from "#/shared/BackendRequestContext";
import { AdministrativeOperationId } from "#/shared/Operation";

import type { AccountSecurityCommitState } from "./AccountSecurityCommitState";

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
  readonly commitState?: AccountSecurityCommitState;
  readonly operation: ExternalRecoveryIdentityManagementOperation;
  readonly reason: ExternalRecoveryIdentityManagementReason;
}> {}

export interface ExternalRecoveryIdentityManagementShape {
  readonly enroll: (
    command: EnrollExternalRecoveryIdentityCommand
  ) => Effect.Effect<
    Schema.Schema.Type<typeof ExternalRecoveryIdentitySchema>,
    ExternalRecoveryIdentityManagementError,
    AuthPermission.CurrentPrincipal | BackendRequestContext | CurrentRequestAuth
  >;
  readonly verify: (
    command: VerifyExternalRecoveryIdentityCommand
  ) => Effect.Effect<
    Schema.Schema.Type<typeof ExternalRecoveryIdentitySchema>,
    ExternalRecoveryIdentityManagementError,
    AuthPermission.CurrentPrincipal | BackendRequestContext | CurrentRequestAuth
  >;
}

/** Authenticated recovery-only lifecycle; it never creates login identities. */
export class ExternalRecoveryIdentityManagement extends Context.Service<
  ExternalRecoveryIdentityManagement,
  ExternalRecoveryIdentityManagementShape
>()("cloudflare-inbox/ExternalRecoveryIdentityManagement", {
  make: Effect.gen(function* () {
    return yield* ExternalRecoveryIdentityTransaction;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
