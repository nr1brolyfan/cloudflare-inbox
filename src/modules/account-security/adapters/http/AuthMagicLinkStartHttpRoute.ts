import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import type { AuthRateLimitService } from "@effect-auth/core/AuthRateLimit";
import { Email, IpAddress } from "@effect-auth/core/Identifiers";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { AuthRuntimeConfig } from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";
import { MagicLinkStarter } from "#/modules/account-security/adapters/effect-auth/MagicLinkStartEffectAuth";
import type { MagicLinkStarterShape } from "#/modules/account-security/adapters/effect-auth/MagicLinkStartEffectAuth";
import { isRecoverySafeEmailInitiationDenied } from "#/modules/account-security/adapters/effect-auth/RecoverySafeEmailInitiationEffectAuth";
import { authRequestOriginAllowed } from "#/modules/account-security/adapters/http/AuthRequestOrigin";

const MagicLinkStartPayload = Schema.Struct({
  identity: Schema.Struct({
    scope: Schema.Union([
      Schema.Struct({ type: Schema.Literal("global") }),
      Schema.Struct({
        type: Schema.Literal("tenant"),
        tenantId: Schema.String,
      }),
    ]),
    kind: Schema.String,
    value: Schema.String,
  }),
  secret: Schema.optional(Schema.String),
  locale: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  botChallenge: Schema.optional(Schema.Struct({ token: Schema.String })),
});

type MagicLinkStartPayload = typeof MagicLinkStartPayload.Type;

const json = (
  status: number,
  body: unknown,
  headers?: Record<string, string>
) => HttpServerResponse.jsonUnsafe(body, { status, headers });

const authError = (
  status: 400 | 403 | 429 | 500,
  tag: string,
  code: string,
  message: string,
  headers?: Record<string, string>,
  fields?: Record<string, unknown>
) => json(status, { _tag: tag, code, message, ...fields }, headers);

const requestIp = (request: HttpServerRequest.HttpServerRequest) => {
  const value =
    request.headers["cf-connecting-ip"] ??
    request.headers["true-client-ip"] ??
    request.headers["x-forwarded-for"]?.split(",", 1)[0]?.trim() ??
    request.headers["x-real-ip"];
  return value === undefined || value === "" ? undefined : IpAddress(value);
};

const failureResponse = (error: unknown) => {
  if (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "RateLimitExceededError" &&
    "retryAfter" in error
  ) {
    const retryAfter = Math.max(
      1,
      Math.ceil(Duration.toSeconds(error.retryAfter as Duration.Duration))
    );
    return authError(
      429,
      "AuthRateLimitedError",
      "rate_limited",
      "Too many requests",
      { "retry-after": String(retryAfter) },
      {
        retryAfter: {
          _id: "Duration",
          _tag: "Millis",
          millis: Duration.toMillis(error.retryAfter as Duration.Duration),
        },
      }
    );
  }
  if (isRecoverySafeEmailInitiationDenied(error)) {
    return authError(
      403,
      "AuthPolicyDeniedError",
      "policy_denied",
      "Email initiation denied"
    );
  }
  return authError(
    500,
    "AuthInternalError",
    "internal_error",
    "Failed to start magic link"
  );
};

export const makeAuthMagicLinkStartHandler = (dependencies: {
  readonly allowedOrigin: string;
  readonly authRateLimit: AuthRateLimitService;
  readonly starter: MagicLinkStarterShape;
}) =>
  Effect.fn("auth.http.magic_link.start_isolated")(function* (
    request: HttpServerRequest.HttpServerRequest
  ) {
    if (!authRequestOriginAllowed(request, dependencies.allowedOrigin)) {
      return authError(
        403,
        "AuthRequestRejectedError",
        "request_rejected",
        "Request origin is not allowed"
      );
    }
    const payloadOption = yield* request.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(MagicLinkStartPayload)),
      Effect.option
    );
    if (Option.isNone(payloadOption)) {
      return authError(
        400,
        "AuthBadRequestError",
        "bad_request",
        "Invalid request"
      );
    }
    const payload: MagicLinkStartPayload = payloadOption.value;
    const ipAddress = requestIp(request);
    const operation = Effect.gen(function* () {
      yield* dependencies.authRateLimit.require({
        operation: "auth.magic_link.start",
        ...(ipAddress === undefined ? {} : { ipAddress }),
        ...(payload.identity.kind === "email"
          ? { email: Email(payload.identity.value) }
          : {}),
      });
      if (payload.secret !== undefined) {
        return yield* Effect.fail({ _tag: "InvalidInitiationSecret" as const });
      }
      return yield* dependencies.starter.start({
        identity: payload.identity,
        locale: payload.locale,
        metadata: payload.metadata,
      });
    });
    const result = yield* operation.pipe(
      Effect.match({
        onFailure: (error) => ({ _tag: "failure" as const, error }),
        onSuccess: (started) => ({ _tag: "success" as const, started }),
      })
    );
    if (result._tag === "failure") {
      if (result.error._tag === "InvalidInitiationSecret") {
        return authError(
          400,
          "AuthBadRequestError",
          "bad_request",
          "Invalid magic link request"
        );
      }
      return failureResponse(result.error);
    }
    return json(200, {
      identity: payload.identity,
      expiresAt: result.started.expiresAt,
    });
  });

const registerRoutes = HttpRouter.use;

export const AuthMagicLinkStartHttpRouteLayer = registerRoutes((router) =>
  Effect.gen(function* () {
    const config = yield* AuthRuntimeConfig;
    const authRateLimit = yield* AuthRateLimit;
    const starter = yield* MagicLinkStarter;
    yield* router.add(
      "POST",
      "/auth/magic-link/start",
      makeAuthMagicLinkStartHandler({
        allowedOrigin: config.publicOrigin.origin,
        authRateLimit,
        starter,
      })
    );
  })
);
