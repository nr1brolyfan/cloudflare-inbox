/* oxlint-disable max-classes-per-file -- Account-recovery models, evidence, error, and ports form one boundary. */
import { defineCustomEvidence } from "@effect-auth/core/Assurance";
import { AuthFlowIdSchema } from "@effect-auth/core/Identifiers";
import type { IssuedSession } from "@effect-auth/core/Sessions";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { EmailAddress } from "#/modules/mailbox/domain/Mailbox";

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
export const CompleteAccountRecoveryCommand = Schema.Struct({
  code: Schema.Trimmed.pipe(Schema.check(Schema.isLengthBetween(8, 128))),
  flowId: AuthFlowIdSchema,
  secret: Schema.String.pipe(Schema.check(Schema.isLengthBetween(32, 512))),
});

export class AccountRecoveryAccepted extends Schema.Class<AccountRecoveryAccepted>(
  "cloudflare-inbox/AccountRecoveryAccepted"
)({
  accepted: Schema.Literal(true),
}) {}

export class AccountRecoveryError extends Data.TaggedError(
  "AccountRecoveryError"
)<{
  readonly cause?: unknown;
  readonly operation: "complete" | "start";
  readonly reason:
    | "delivery"
    | "indeterminate"
    | "invalid-input"
    | "invalid-proof"
    | "rate-limited"
    | "storage";
}> {}

export interface AccountRecoveryDeliveryService {
  readonly send: (input: {
    readonly address: EmailAddress;
    readonly expiresAt: number;
    readonly flowId: string;
    readonly secret: Redacted.Redacted<string>;
  }) => Effect.Effect<void, AccountRecoveryError>;
}

export class AccountRecoveryDelivery extends Context.Service<
  AccountRecoveryDelivery,
  AccountRecoveryDeliveryService
>()("cloudflare-inbox/AccountRecoveryDelivery") {}

export interface AccountRecoveryService {
  readonly complete: (
    command: Schema.Schema.Type<typeof CompleteAccountRecoveryCommand>
  ) => Effect.Effect<IssuedSession, AccountRecoveryError>;
  readonly start: (
    command: Schema.Schema.Type<typeof StartAccountRecoveryCommand>
  ) => Effect.Effect<AccountRecoveryAccepted, AccountRecoveryError>;
}

export class AccountRecovery extends Context.Service<
  AccountRecovery,
  AccountRecoveryService
>()("cloudflare-inbox/AccountRecovery") {}

export const accountRecoveryAccepted = AccountRecoveryAccepted.make({
  accepted: true,
});
