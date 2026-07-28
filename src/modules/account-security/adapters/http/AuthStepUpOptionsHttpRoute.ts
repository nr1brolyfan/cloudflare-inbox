import type { AuthRateLimitService } from "@effect-auth/core/AuthRateLimit";
import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import type { RequestSessionAuthenticatorShape } from "#/modules/account-security/adapters/http/RequestSessionAuthentication";
import { RequestSessionAuthenticator } from "#/modules/account-security/adapters/http/RequestSessionAuthentication";
import type { PasskeyAuthenticationIdentityStoreShape } from "#/modules/account-security/ports/PasskeyAuthenticationIdentityStore";
import { PasskeyAuthenticationIdentityStore } from "#/modules/account-security/ports/PasskeyAuthenticationIdentityStore";
import type { StepUpFactorReaderShape } from "#/modules/account-security/ports/StepUpFactorReader";
import { StepUpFactorReader } from "#/modules/account-security/ports/StepUpFactorReader";

const json = (
  status: number,
  body: unknown,
  headers?: Record<string, string>
) => HttpServerResponse.jsonUnsafe(body, { status, headers });

const internalError = () =>
  json(500, {
    _tag: "AuthInternalError",
    code: "internal_error",
    message: "Failed to complete step-up authentication",
  });

const unauthenticated = () =>
  json(401, {
    _tag: "AuthUnauthenticatedError",
    code: "unauthenticated",
    message: "Unauthenticated",
  });

const attempt = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.match({
      onFailure: (error) => ({ _tag: "failure" as const, error }),
      onSuccess: (value) => ({ _tag: "success" as const, value }),
    })
  );

export const makeAuthStepUpOptionsHandler = (dependencies: {
  readonly authRateLimit: AuthRateLimitService;
  readonly authenticator: RequestSessionAuthenticatorShape;
  readonly factors: StepUpFactorReaderShape;
  readonly passkeyIdentities: PasskeyAuthenticationIdentityStoreShape;
}) =>
  Effect.fn("auth.http.step_up.options_isolated")(function* (
    request: HttpServerRequest.HttpServerRequest
  ) {
    const webRequest = yield* attempt(HttpServerRequest.toWeb(request));
    if (webRequest._tag === "failure") {
      return internalError();
    }

    const authentication = yield* attempt(
      dependencies.authenticator.authenticate(webRequest.value)
    );
    if (authentication._tag === "failure") {
      return authentication.error._tag === "AuthUnauthenticatedError"
        ? unauthenticated()
        : internalError();
    }

    const authenticated = authentication.value;
    if ((authenticated.session.claims?.requirements?.length ?? 0) !== 0) {
      return json(403, {
        _tag: "AuthPolicyDeniedError",
        code: "policy_denied",
        message: "Complete pending account requirements before step-up",
      });
    }

    const rateLimit = yield* attempt(
      dependencies.authRateLimit.require({
        operation: "auth.step_up.options",
        userId: authenticated.session.userId,
      })
    );
    if (rateLimit._tag === "failure") {
      if (rateLimit.error._tag !== "RateLimitExceededError") {
        return internalError();
      }
      const retryAfter = Math.max(
        1,
        Math.ceil(Duration.toSeconds(rateLimit.error.retryAfter))
      );
      return json(
        429,
        {
          _tag: "AuthRateLimitedError",
          code: "rate_limited",
          message: "Too many step-up attempts",
          retryAfter: {
            _id: "Duration",
            _tag: "Millis",
            millis: Duration.toMillis(rateLimit.error.retryAfter),
          },
        },
        { "retry-after": String(retryAfter) }
      );
    }

    const passwordAvailable = yield* attempt(
      dependencies.factors.passwordAvailable(authenticated.session.userId)
    );
    if (passwordAvailable._tag === "failure") {
      return internalError();
    }

    const passkeyEligible = yield* attempt(
      dependencies.passkeyIdentities.eligible(authenticated.session.userId)
    );
    if (passkeyEligible._tag === "failure") {
      return internalError();
    }
    const passkeys = passkeyEligible.value
      ? yield* attempt(
          dependencies.factors.passkeyAvailable(authenticated.session.userId)
        )
      : ({ _tag: "success", value: false } as const);
    if (passkeys._tag === "failure") {
      return internalError();
    }

    return json(200, {
      factors: [
        ...(passwordAvailable.value ? [{ type: "password" }] : []),
        ...(passkeys.value ? [{ type: "passkey" }] : []),
      ],
    });
  });

const registerRoutes = HttpRouter.use;

/** Exact step-up options route, independent from the aggregate auth HTTP API. */
export const AuthStepUpOptionsHttpRouteLayer = registerRoutes((router) =>
  Effect.gen(function* () {
    const authRateLimit = yield* AuthRateLimit;
    const authenticator = yield* RequestSessionAuthenticator;
    const factors = yield* StepUpFactorReader;
    const passkeyIdentities = yield* PasskeyAuthenticationIdentityStore;
    yield* router.add(
      "GET",
      "/auth/step-up/options",
      makeAuthStepUpOptionsHandler({
        authRateLimit,
        authenticator,
        factors,
        passkeyIdentities,
      })
    );
  })
);
