import * as Context from "effect/Context";

import type { RecoveryCodeAdministrationService } from "#/modules/account-security/application/RecoveryCodeAdministration";

/** Atomic recovery-code rotation supplied by persistence adapters. */
export class RecoveryCodeAdministrationTransaction extends Context.Service<
  RecoveryCodeAdministrationTransaction,
  RecoveryCodeAdministrationService
>()("cloudflare-inbox/RecoveryCodeAdministrationTransaction") {}
