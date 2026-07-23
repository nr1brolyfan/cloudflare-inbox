import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { RequireExternalRecoveryAddressInput } from "#/modules/account-security/domain/ExternalRecoveryIdentity";
import type { RecoverySafeIdentityRejected } from "#/modules/account-security/domain/RecoverySafeIdentityError";

export interface RecoverySafeIdentityPolicyShape {
  readonly requireExternalRecoveryAddress: (
    input: RequireExternalRecoveryAddressInput
  ) => Effect.Effect<void, RecoverySafeIdentityRejected>;
}

/** Shared policy boundary for every standalone recovery-email proof. */
export class RecoverySafeIdentityPolicy extends Context.Service<
  RecoverySafeIdentityPolicy,
  RecoverySafeIdentityPolicyShape
>()("cloudflare-inbox/RecoverySafeIdentityPolicy") {}
