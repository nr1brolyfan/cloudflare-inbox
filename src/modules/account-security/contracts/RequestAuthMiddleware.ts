/* oxlint-disable max-classes-per-file -- Session authentication policies share one public middleware contract. */
import {
  AuthInternalError,
  AuthPolicyDeniedError,
  AuthUnauthenticatedError,
} from "@effect-auth/core/HttpApi";
import type { CurrentPrincipal } from "@effect-auth/core/Permission";
import type { CurrentActor, CurrentSession } from "@effect-auth/core/Sessions";
import { HttpApiMiddleware } from "effect/unstable/httpapi";

import type { CurrentRequestAuth } from "#/shared/RequestAuth";

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

/** Policy-neutral session authentication for groups with their own session matrix. */
export class SessionAuthenticationMiddleware extends HttpApiMiddleware.Service<
  SessionAuthenticationMiddleware,
  {
    provides:
      | CurrentRequestAuth
      | CurrentSession
      | CurrentActor
      | CurrentPrincipal;
  }
>()("cloudflare-inbox/SessionAuthenticationMiddleware", {
  error: [AuthUnauthenticatedError, AuthInternalError],
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
