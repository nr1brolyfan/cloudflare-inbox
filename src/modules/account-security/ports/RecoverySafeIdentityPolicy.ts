import { UserIdSchema } from "@effect-auth/core/Identifiers";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ExternalRecoveryIdentityId } from "#/modules/account-security/domain/ExternalRecoveryIdentity";
import type { RecoverySafeIdentityRejected } from "#/modules/account-security/domain/RecoverySafeIdentityError";
import { EmailAddress } from "#/shared/EmailAddress";

export const RecoverySafeIdentityRequest = Schema.Union([
  Schema.Struct({
    address: EmailAddress,
    excludeRecoveryIdentityId: Schema.optional(ExternalRecoveryIdentityId),
    purpose: Schema.Literal("external-recovery"),
    userId: Schema.optional(UserIdSchema),
  }),
  Schema.Struct({
    address: EmailAddress,
    purpose: Schema.Literal("login-email-initiation"),
  }),
]);
export type RecoverySafeIdentityRequest = Schema.Schema.Type<
  typeof RecoverySafeIdentityRequest
>;

export interface RecoverySafeIdentityPolicyShape {
  readonly requireSafeAddress: (
    input: RecoverySafeIdentityRequest
  ) => Effect.Effect<void, RecoverySafeIdentityRejected>;
}

/** Shared policy boundary for recovery-safe email address use. */
export class RecoverySafeIdentityPolicy extends Context.Service<
  RecoverySafeIdentityPolicy,
  RecoverySafeIdentityPolicyShape
>()("cloudflare-inbox/RecoverySafeIdentityPolicy") {}
