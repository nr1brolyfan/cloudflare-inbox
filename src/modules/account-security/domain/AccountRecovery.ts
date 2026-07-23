/* oxlint-disable max-classes-per-file -- Account-recovery models, evidence, error, and ports form one boundary. */
import { defineCustomEvidence } from "@effect-auth/core/Assurance";
import { AuthFlowIdSchema } from "@effect-auth/core/Identifiers";
import * as Data from "effect/Data";
import * as Schema from "effect/Schema";

import { EmailAddress } from "#/shared/EmailAddress";
import { AdministrativeOperationId } from "#/shared/Operation";
import { UnixMillis } from "#/shared/Temporal";

export const ACCOUNT_RECOVERY_EVIDENCE_POLICY_ID =
  "cloudflare-inbox/external-recovery-link";
export const ACCOUNT_RECOVERY_EVIDENCE_POLICY_VERSION = 1;

export const externalRecoveryLinkEvidence = defineCustomEvidence({
  evaluate: () => ({
    amr: "external_recovery_link",
    level: "aal1",
    role: "primary",
  }),
  kind: "external-recovery-link",
  policyId: ACCOUNT_RECOVERY_EVIDENCE_POLICY_ID,
  policyVersion: ACCOUNT_RECOVERY_EVIDENCE_POLICY_VERSION,
  properties: Schema.Struct({
    externalRecoveryIdentityId: Schema.String,
    externalRecoveryIdentityVersion: Schema.Number,
  }),
});

export const StartAccountRecoveryCommand = Schema.Struct({
  address: EmailAddress,
});
export const AccountRecoveryReadbackSecret = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/u)),
  Schema.brand("cloudflare-inbox/AccountRecoveryReadbackSecret")
);
export type AccountRecoveryReadbackSecret = Schema.Schema.Type<
  typeof AccountRecoveryReadbackSecret
>;
export const CompleteAccountRecoveryCommand = Schema.Struct({
  code: Schema.Trimmed.pipe(Schema.check(Schema.isLengthBetween(8, 128))),
  flowId: AuthFlowIdSchema,
  operationId: AdministrativeOperationId,
  readbackSecret: AccountRecoveryReadbackSecret,
  secret: Schema.String.pipe(Schema.check(Schema.isLengthBetween(32, 512))),
});
export type CompleteAccountRecoveryCommand = Schema.Schema.Type<
  typeof CompleteAccountRecoveryCommand
>;

export const ReadAccountRecoveryCompletionCommand = Schema.Struct({
  operationId: AdministrativeOperationId,
  readbackSecret: AccountRecoveryReadbackSecret,
});
export type ReadAccountRecoveryCompletionCommand = Schema.Schema.Type<
  typeof ReadAccountRecoveryCompletionCommand
>;

export class AccountRecoveryCompletionReceipt extends Schema.Class<AccountRecoveryCompletionReceipt>(
  "cloudflare-inbox/AccountRecoveryCompletionReceipt"
)({
  completedAt: UnixMillis,
  operationId: AdministrativeOperationId,
  schemaVersion: Schema.Literal(1),
  status: Schema.Literal("recovery-remediation-required"),
}) {}

export class AccountRecoveryAccepted extends Schema.Class<AccountRecoveryAccepted>(
  "cloudflare-inbox/AccountRecoveryAccepted"
)({
  accepted: Schema.Literal(true),
}) {}

export class AccountRecoveryError extends Data.TaggedError(
  "AccountRecoveryError"
)<{
  readonly cause?: unknown;
  readonly operation: "complete" | "read-completion" | "start";
  readonly reason:
    | "delivery"
    | "indeterminate"
    | "invalid-input"
    | "invalid-proof"
    | "rate-limited"
    | "storage";
}> {}

export const accountRecoveryAccepted = AccountRecoveryAccepted.make({
  accepted: true,
});
