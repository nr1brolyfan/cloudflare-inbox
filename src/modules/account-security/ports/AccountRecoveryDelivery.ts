import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";

import type { AccountRecoveryError } from "#/modules/account-security/domain/AccountRecovery";
import type { EmailAddress } from "#/modules/address-routing/domain/EmailAddress";

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
