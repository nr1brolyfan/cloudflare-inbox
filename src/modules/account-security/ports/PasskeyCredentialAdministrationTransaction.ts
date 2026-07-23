import * as Context from "effect/Context";

import type { PasskeyCredentialAdministrationShape } from "#/modules/account-security/application/PasskeyCredentialAdministration";

/** Atomic passkey administration supplied by persistence adapters. */
export class PasskeyCredentialAdministrationTransaction extends Context.Service<
  PasskeyCredentialAdministrationTransaction,
  PasskeyCredentialAdministrationShape
>()("cloudflare-inbox/PasskeyCredentialAdministrationTransaction") {}
