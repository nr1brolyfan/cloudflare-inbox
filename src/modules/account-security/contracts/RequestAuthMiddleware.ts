/* oxlint-disable max-classes-per-file -- Normal and recovery auth are one public middleware contract. */
import {
  AuthInternalError,
  AuthPolicyDeniedError,
  AuthUnauthenticatedError,
} from "@effect-auth/core/HttpApi";
import type { CurrentPrincipal } from "@effect-auth/core/Permission";
import type { CurrentActor, CurrentSession } from "@effect-auth/core/Sessions";
import { HttpApiMiddleware } from "effect/unstable/httpapi";

import type { CurrentRequestAuth } from "#/modules/account-security/ports/CurrentRequestAuth";

/** Stable authenticated-request middleware contract shared with other APIs. */
export class CurrentRequestAuthMiddleware extends HttpApiMiddleware.Service<
  CurrentRequestAuthMiddleware,
  {
    provides:
      | CurrentRequestAuth
      | CurrentSession
      | CurrentActor
      | CurrentPrincipal;
  }
>()("cloudflare-inbox/CurrentRequestAuthMiddleware", {
  error: [AuthUnauthenticatedError, AuthPolicyDeniedError, AuthInternalError],
}) {}

export class RecoveryRemediationRequestAuthMiddleware extends HttpApiMiddleware.Service<
  RecoveryRemediationRequestAuthMiddleware,
  {
    provides:
      | CurrentRequestAuth
      | CurrentSession
      | CurrentActor
      | CurrentPrincipal;
  }
>()("cloudflare-inbox/RecoveryRemediationRequestAuthMiddleware", {
  error: [AuthUnauthenticatedError, AuthPolicyDeniedError, AuthInternalError],
}) {}
