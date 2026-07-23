import * as Context from "effect/Context";

import type { AccountRecoveryService } from "#/modules/account-security/application/AccountRecovery";

/** Transaction-capable account recovery execution supplied by persistence adapters. */
export class AccountRecoveryTransaction extends Context.Service<
  AccountRecoveryTransaction,
  AccountRecoveryService
>()("cloudflare-inbox/AccountRecoveryTransaction") {}
