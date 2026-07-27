import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import { IpAddress } from "@effect-auth/core/Identifiers";
import { MagicLinkLogin } from "@effect-auth/core/MagicLink";
import type { MagicLinkVerifyResult } from "@effect-auth/core/MagicLink";
import { SessionCookie } from "@effect-auth/core/Sessions";
import type { SessionCookieService } from "@effect-auth/core/Sessions";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { AuthRuntimeConfig } from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";

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

const requestOriginAllowed = (
  request: HttpServerRequest.HttpServerRequest,
  allowedOrigin: string
) => {
  const { origin, referer } = request.headers;
  if (origin !== undefined) {
    return origin === allowedOrigin;
  }
  if (referer === undefined) {
    return false;
  }
  try {
    return new URL(referer).origin === allowedOrigin;
  } catch {
    return false;
  }
};

const requestIp = (request: HttpServerRequest.HttpServerRequest) => {
  const value =
    request.headers["cf-connecting-ip"] ??
    request.headers["true-client-ip"] ??
    request.headers["x-forwarded-for"]?.split(",", 1)[0]?.trim() ??
    request.headers["x-real-ip"];
  return value === undefined || value === "" ? undefined : IpAddress(value);
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
        // oxlint-disable-next-line promise/prefer-await-to-then -- Effect error recovery, not a Promise chain.
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
    case "RequiresLoginApproval": {
      return Effect.succeed(
        errorResponse(
          500,
          "AuthInternalError",
          "internal_error",
          "Failed to encode authentication response"
        )
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
    if (!requestOriginAllowed(request, dependencies.allowedOrigin)) {
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
    const verified = yield* dependencies.authRateLimit
      .require({
        operation: "auth.magic_link.verify",
        ...(ipAddress === undefined ? {} : { ipAddress }),
      })
      .pipe(
        Effect.andThen(
          dependencies.magicLink.verify({
            challengeId: payload.value.challengeId as never,
            secret: Redacted.make(payload.value.secret),
          })
        ),
        Effect.option
      );
    if (Option.isNone(verified)) {
      return errorResponse(
        500,
        "AuthInternalError",
        "internal_error",
        "Failed to verify magic link"
      );
    }
    return yield* commitResult(verified.value, dependencies.sessionCookie);
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
