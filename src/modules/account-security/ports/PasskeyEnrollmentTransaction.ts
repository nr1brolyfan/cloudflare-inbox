import * as Context from "effect/Context";

import type { PasskeyEnrollmentShape } from "#/modules/account-security/application/PasskeyEnrollment";

/** Atomic passkey enrollment supplied by persistence adapters. */
export class PasskeyEnrollmentTransaction extends Context.Service<
  PasskeyEnrollmentTransaction,
  PasskeyEnrollmentShape
>()("cloudflare-inbox/PasskeyEnrollmentTransaction") {}
