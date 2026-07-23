import type { IssuedSession } from "@effect-auth/core/Sessions";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Schema from "effect/Schema";

import type {
  AccountRecoveryAccepted,
  AccountRecoveryCompletionReceipt,
  AccountRecoveryError,
  CompleteAccountRecoveryCommand,
  StartAccountRecoveryCommand,
} from "#/modules/account-security/domain/AccountRecovery";
import { AccountRecoveryTransaction } from "#/modules/account-security/ports/AccountRecoveryTransaction";

export interface AccountRecoveryService {
  readonly complete: (
    command: Schema.Schema.Type<typeof CompleteAccountRecoveryCommand>
  ) => Effect.Effect<AccountRecoveryCompletionResult, AccountRecoveryError>;
  readonly readCompletion: (
    command: unknown
  ) => Effect.Effect<AccountRecoveryCompletionReceipt, AccountRecoveryError>;
  readonly start: (
    command: Schema.Schema.Type<typeof StartAccountRecoveryCommand>
  ) => Effect.Effect<AccountRecoveryAccepted, AccountRecoveryError>;
}

export type AccountRecoveryCompletionResult =
  | {
      readonly _tag: "AccountRecoveryCompleted";
      readonly receipt: AccountRecoveryCompletionReceipt;
      readonly session: IssuedSession;
    }
  | {
      readonly _tag: "AccountRecoveryAlreadyCompleted";
      readonly receipt: AccountRecoveryCompletionReceipt;
    };

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
