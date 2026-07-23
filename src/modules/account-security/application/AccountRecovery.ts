import type { IssuedSession } from "@effect-auth/core/Sessions";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";

import type {
  AccountRecoveryAccepted,
  AccountRecoveryError,
  CompleteAccountRecoveryCommand,
  StartAccountRecoveryCommand,
} from "#/modules/account-security/domain/AccountRecovery";

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
