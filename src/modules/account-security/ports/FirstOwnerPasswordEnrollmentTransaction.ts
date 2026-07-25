import * as Context from "effect/Context";

import type { FirstOwnerPasswordEnrollmentService } from "#/modules/account-security/application/FirstOwnerPasswordEnrollment";

/** Atomic first-owner password enrollment supplied by persistence adapters. */
export class FirstOwnerPasswordEnrollmentTransaction extends Context.Service<
  FirstOwnerPasswordEnrollmentTransaction,
  FirstOwnerPasswordEnrollmentService
>()("cloudflare-inbox/FirstOwnerPasswordEnrollmentTransaction") {}
