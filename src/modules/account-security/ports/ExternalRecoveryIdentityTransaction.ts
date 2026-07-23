import * as Context from "effect/Context";

import type { ExternalRecoveryIdentityManagementShape } from "#/modules/account-security/application/ExternalRecoveryIdentityManagement";

/** Atomic recovery-identity lifecycle supplied by persistence adapters. */
export class ExternalRecoveryIdentityTransaction extends Context.Service<
  ExternalRecoveryIdentityTransaction,
  ExternalRecoveryIdentityManagementShape
>()("cloudflare-inbox/ExternalRecoveryIdentityTransaction") {}
