import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ExternalRecoveryIdentityManagementError } from "#/modules/account-security/application/ExternalRecoveryIdentityManagement";
import type { IssuedExternalRecoveryChallenge } from "#/modules/account-security/ports/ExternalRecoveryIdentityChallenge";
import type { EmailAddress } from "#/modules/address-routing/domain/EmailAddress";

export interface ExternalRecoveryIdentityDeliveryShape {
  readonly sendVerification: (input: {
    readonly address: EmailAddress;
    readonly challenge: IssuedExternalRecoveryChallenge;
  }) => Effect.Effect<void, ExternalRecoveryIdentityManagementError>;
}

export class ExternalRecoveryIdentityDelivery extends Context.Service<
  ExternalRecoveryIdentityDelivery,
  ExternalRecoveryIdentityDeliveryShape
>()("cloudflare-inbox/ExternalRecoveryIdentityDelivery") {}
