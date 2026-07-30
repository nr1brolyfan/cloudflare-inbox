import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import { magicLinkVerifyInput } from "@effect-auth/core/HttpApi/MagicLink";
import { ChallengeId, IpAddress } from "@effect-auth/core/Identifiers";
import { MagicLinkLogin } from "@effect-auth/core/MagicLink";
import type { MagicLinkVerifyResult } from "@effect-auth/core/MagicLink";
import { SessionCookie } from "@effect-auth/core/Sessions";
import type { SessionCookieService } from "@effect-auth/core/Sessions";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { AuthRuntimeConfig } from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";
import { authRequestOriginAllowed } from "#/modules/account-security/adapters/http/AuthRequestOrigin";

const MagicLinkVerifyPayload = Schema.Struct({
  challengeId: Schema.String,
  secret: Schema.String,
});

const json = (
  status: number,
  body: unknown,
  headers?: Record<string, string>
) => HttpServerResponse.jsonUnsafe(body, { status, headers });

const errorResponse = (
  status: 400 | 401 | 403 | 429 | 500,
  tag: string,
  code: string,
  message: string
) => json(status, { _tag: tag, code, message });

const requestIp = (request: HttpServerRequest.HttpServerRequest) => {
  const value =
    request.headers["cf-connecting-ip"] ??
    request.headers["true-client-ip"] ??
    request.headers["x-forwarded-for"]?.split(",", 1)[0]?.trim() ??
    request.headers["x-real-ip"];
  return value === undefined || value === "" ? undefined : IpAddress(value);
};

const firstHeaderValue = (value: string | undefined) =>
  value?.split(",", 1)[0]?.trim() || undefined;

const headerNumber = (value: string | undefined) => {
  const parsed = Number(firstHeaderValue(value));
  return Number.isFinite(parsed) ? parsed : undefined;
};

const loginRequestContext = (
  request: HttpServerRequest.HttpServerRequest,
  ipAddress: ReturnType<typeof requestIp>
) => {
  const { headers } = request;
  const country = firstHeaderValue(headers["cf-ipcountry"]);
  const region = firstHeaderValue(headers["cf-region"]);
  const city = firstHeaderValue(headers["cf-ipcity"]);
  const latitude = headerNumber(headers["cf-iplatitude"]);
  const longitude = headerNumber(headers["cf-iplongitude"]);
  return {
    ...(ipAddress === undefined ? {} : { ip: String(ipAddress) }),
    ...(headers["user-agent"] === undefined
      ? {}
      : { userAgent: headers["user-agent"] }),
    ...(country === undefined ? {} : { country }),
    ...(region === undefined ? {} : { region }),
    ...(city === undefined ? {} : { city }),
    ...(latitude === undefined ? {} : { latitude }),
    ...(longitude === undefined ? {} : { longitude }),
  };
};

const sessionClaimsBody = (claims: {
  readonly verifiedIdentityKinds?: readonly string[];
  readonly requirements?: readonly string[];
  readonly recoveryEnrollment?: { readonly allowed: readonly string[] };
}) => ({
  ...(claims.verifiedIdentityKinds === undefined
    ? {}
    : { verifiedIdentityKinds: claims.verifiedIdentityKinds }),
  ...(claims.requirements === undefined
    ? {}
    : { requirements: claims.requirements }),
  ...(claims.recoveryEnrollment === undefined
    ? {}
    : { recoveryEnrollment: claims.recoveryEnrollment }),
});

const commitResult = (
  result: MagicLinkVerifyResult,
  sessionCookie: SessionCookieService
) => {
  switch (result._tag) {
    case "InvalidCredentials":
    case "AccountDisabled": {
      return Effect.succeed(
        errorResponse(
          401,
          "AuthInvalidCredentialsError",
          "invalid_credentials",
          "Invalid credentials"
        )
      );
    }
    case "PolicyDenied": {
      return Effect.succeed(
        errorResponse(
          403,
          "AuthPolicyDeniedError",
          "policy_denied",
          "Authentication policy denied the request"
        )
      );
    }
    case "Authenticated": {
      const { session } = result;
      return sessionCookie.commit(session).pipe(
        Effect.map((cookie) =>
          json(
            200,
            {
              type: "authenticated",
              expiresAt: Number(session.expiresAt),
              aal: session.aal,
              amr: session.amr,
              ...(session.mfaVerifiedAt === undefined
                ? {}
                : { mfaVerifiedAt: session.mfaVerifiedAt }),
              ...(session.claims === undefined
                ? {}
                : { claims: sessionClaimsBody(session.claims) }),
            },
            { "set-cookie": cookie }
          )
        ),
        // oxlint-disable-next-line promise/prefer-await-to-then -- Effect recovery, not a Promise chain.
        Effect.catch(() =>
          Effect.succeed(
            errorResponse(
              500,
              "AuthInternalError",
              "internal_error",
              "Failed to commit session cookie"
            )
          )
        )
      );
    }
    case "RequiresMfa": {
      return Effect.succeed(
        json(200, {
          type: "requires_mfa",
          flowId: result.flowId,
          factors: result.factors.map(({ type }) => ({ type })),
        })
      );
    }
    case "RequiresEmailVerification": {
      return Effect.succeed(
        json(200, {
          type: "requires_email_verification",
          flowId: result.flowId,
          identityId: result.identityId,
        })
      );
    }
    case "RequiresPasskeyEnrollment": {
      return Effect.succeed(
        json(200, {
          type: "requires_passkey_enrollment",
          flowId: result.flowId,
        })
      );
    }
    default: {
      return Effect.succeed(
        errorResponse(
          500,
          "AuthInternalError",
          "internal_error",
          "Failed to encode authentication response"
        )
      );
    }
  }
};

export const makeAuthMagicLinkVerifyHandler = (dependencies: {
  readonly allowedOrigin: string;
  readonly authRateLimit: AuthRateLimit["Service"];
  readonly magicLink: MagicLinkLogin["Service"];
  readonly sessionCookie: SessionCookieService;
}) =>
  Effect.fn("auth.http.magic_link.verify_isolated")(function* (
    request: HttpServerRequest.HttpServerRequest
  ) {
    if (!authRequestOriginAllowed(request, dependencies.allowedOrigin)) {
      return errorResponse(
        403,
        "AuthRequestRejectedError",
        "request_rejected",
        "Request origin is not allowed"
      );
    }
    const payload = yield* request.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(MagicLinkVerifyPayload)),
      Effect.option
    );
    if (Option.isNone(payload)) {
      return errorResponse(
        400,
        "AuthBadRequestError",
        "bad_request",
        "Invalid request"
      );
    }
    const ipAddress = requestIp(request);
    const verification = dependencies.authRateLimit
      .require({
        operation: "auth.magic_link.verify",
        ...(ipAddress === undefined ? {} : { ipAddress }),
      })
      .pipe(
        Effect.flatMap(() =>
          dependencies.magicLink.verify(
            magicLinkVerifyInput(
              {
                challengeId: ChallengeId(payload.value.challengeId),
                secret: payload.value.secret,
              },
              undefined,
              loginRequestContext(request, ipAddress)
            )
          )
        )
      );
    const verified = yield* verification.pipe(
      Effect.match({
        onFailure: (error) => ({ _tag: "failure" as const, error }),
        onSuccess: (result) => ({ _tag: "success" as const, result }),
      })
    );
    if (verified._tag === "failure") {
      if (
        typeof verified.error === "object" &&
        verified.error !== null &&
        "_tag" in verified.error &&
        verified.error._tag === "RateLimitExceededError" &&
        "retryAfter" in verified.error
      ) {
        const retryAfter = verified.error.retryAfter as Duration.Duration;
        return json(
          429,
          {
            _tag: "AuthRateLimitedError",
            code: "rate_limited",
            message: "Too many requests",
            retryAfter: {
              _id: "Duration",
              _tag: "Millis",
              millis: Duration.toMillis(retryAfter),
            },
          },
          {
            "retry-after": String(
              Math.max(1, Math.ceil(Duration.toSeconds(retryAfter)))
            ),
          }
        );
      }
      return errorResponse(
        500,
        "AuthInternalError",
        "internal_error",
        "Failed to verify magic link"
      );
    }
    return yield* commitResult(verified.result, dependencies.sessionCookie);
  });

const registerRoutes = HttpRouter.use;

export const AuthMagicLinkVerifyHttpRouteLayer = registerRoutes((router) =>
  Effect.gen(function* () {
    const config = yield* AuthRuntimeConfig;
    const authRateLimit = yield* AuthRateLimit;
    const magicLink = yield* MagicLinkLogin;
    const sessionCookie = yield* SessionCookie;
    yield* router.add(
      "POST",
      "/auth/magic-link/verify",
      makeAuthMagicLinkVerifyHandler({
        allowedOrigin: config.publicOrigin.origin,
        authRateLimit,
        magicLink,
        sessionCookie,
      })
    );
  })
);
