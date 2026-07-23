import type { IssuedSession } from "@effect-auth/core/Sessions";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Schema from "effect/Schema";

import type {
  AccountRecoveryAccepted,
  AccountRecoveryError,
  CompleteAccountRecoveryCommand,
  StartAccountRecoveryCommand,
} from "#/modules/account-security/domain/AccountRecovery";
import { AccountRecoveryTransaction } from "#/modules/account-security/ports/AccountRecoveryTransaction";

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
>()("cloudflare-inbox/AccountRecovery", {
  make: Effect.gen(function* () {
    return yield* AccountRecoveryTransaction;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
