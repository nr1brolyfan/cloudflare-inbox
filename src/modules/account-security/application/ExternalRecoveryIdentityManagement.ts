/* oxlint-disable max-classes-per-file -- Management error and service form one cohesive use case. */
import { ChallengeIdSchema, UserIdSchema } from "@effect-auth/core/Identifiers";
import type * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  ExternalRecoveryIdentityId,
  ExternalRecoveryIdentitySchema,
} from "#/modules/account-security/domain/ExternalRecoveryIdentity";
import { ExternalRecoveryIdentityTransaction } from "#/modules/account-security/ports/ExternalRecoveryIdentityTransaction";
import { EmailAddress } from "#/shared/EmailAddress";
import { AdministrativeOperationId } from "#/shared/Operation";
import type { CurrentRequestAuth } from "#/shared/RequestAuth";
import type { RequestCorrelation } from "#/shared/RequestCorrelation";
import { UnixMillis, Version } from "#/shared/Temporal";

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

export const ReadExternalRecoveryIdentityOperationQuery = Schema.Struct({
  operationId: AdministrativeOperationId,
});
export type ReadExternalRecoveryIdentityOperationQuery = Schema.Schema.Type<
  typeof ReadExternalRecoveryIdentityOperationQuery
>;

export class ExternalRecoveryIdentityOperationReceipt extends Schema.Class<ExternalRecoveryIdentityOperationReceipt>(
  "cloudflare-inbox/ExternalRecoveryIdentityOperationReceipt"
)({
  actorUserId: UserIdSchema,
  challengeId: Schema.optional(ChallengeIdSchema),
  committedAt: UnixMillis,
  expectedIdentityVersion: Schema.optional(Version),
  identityId: ExternalRecoveryIdentityId,
  operationId: AdministrativeOperationId,
  operationKind: Schema.Literals(["enroll", "verify"]),
  result: ExternalRecoveryIdentitySchema,
  schemaVersion: Schema.Literal(1),
}) {}

export const ExternalRecoveryIdentityOperationReceiptSchema =
  ExternalRecoveryIdentityOperationReceipt.check(
    Schema.makeFilter((receipt) => {
      const intentValid =
        receipt.operationKind === "enroll"
          ? receipt.challengeId === undefined &&
            receipt.expectedIdentityVersion === undefined &&
            receipt.result.state._tag === "Pending" &&
            receipt.result.version === 1
          : receipt.challengeId !== undefined &&
            receipt.expectedIdentityVersion !== undefined &&
            receipt.result.state._tag === "Verified" &&
            receipt.result.version === receipt.expectedIdentityVersion + 1;
      return intentValid &&
        receipt.actorUserId === receipt.result.userId &&
        receipt.identityId === receipt.result.id &&
        receipt.committedAt === receipt.result.updatedAt
        ? undefined
        : "external recovery operation receipt intent and result must agree";
    })
  );

export type ExternalRecoveryIdentityManagementOperation =
  | "enroll"
  | "read-operation"
  | "verify";
export type ExternalRecoveryIdentityManagementReason =
  | "challenge-invalid"
  | "delivery"
  | "invalid-input"
  | "not-found"
  | "operation-conflict"
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
    AuthPermission.CurrentPrincipal | CurrentRequestAuth | RequestCorrelation
  >;
  readonly verify: (
    command: VerifyExternalRecoveryIdentityCommand
  ) => Effect.Effect<
    Schema.Schema.Type<typeof ExternalRecoveryIdentitySchema>,
    ExternalRecoveryIdentityManagementError,
    AuthPermission.CurrentPrincipal | CurrentRequestAuth | RequestCorrelation
  >;
  readonly readOperation: (
    query: ReadExternalRecoveryIdentityOperationQuery
  ) => Effect.Effect<
    ExternalRecoveryIdentityOperationReceipt,
    ExternalRecoveryIdentityManagementError,
    AuthPermission.CurrentPrincipal | CurrentRequestAuth | RequestCorrelation
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
