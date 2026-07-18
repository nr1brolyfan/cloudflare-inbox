import { RateLimitDurableObject } from "@effect-auth/core/AlchemyCloudflareRateLimitDurableObject";
import { Email } from "@effect-auth/core/Identifiers";
import { ALCHEMY_DEV } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Etag from "effect/unstable/http/Etag";
import * as HttpPlatform from "effect/unstable/http/HttpPlatform";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { makeAuthHttpApiLive } from "../auth/live";
import {
  AuthEmailSender,
  ControlPlaneDatabase,
  RawMessagesBucket,
} from "../infra/resources";

const HttpPlatformStub = Layer.succeed(HttpPlatform.HttpPlatform, {
  fileResponse: () => Effect.die("HttpPlatform.fileResponse is not supported"),
  fileWebResponse: () =>
    Effect.die("HttpPlatform.fileWebResponse is not supported"),
});

const developmentSecret = (purpose: string) =>
  Redacted.make(`cloudflare-inbox-development-${purpose}-secret`);

const hasCallerProvidedOtpSecret = (request: Request) =>
  Effect.tryPromise({
    try: () => request.clone().json(),
    catch: () => null,
  }).pipe(
    Effect.map(
      (payload) =>
        typeof payload === "object" &&
        payload !== null &&
        Object.hasOwn(payload, "secret")
    ),
    Effect.catchCause(() => Effect.succeed(false))
  );

export default class Backend extends Cloudflare.Worker<Backend>()(
  "Backend",
  {
    main: import.meta.url,
    compatibility: {
      date: "2026-07-11",
      flags: ["nodejs_compat"],
    },
    dev: {
      port: 1338,
      strictPort: true,
    },
    url: false,
  },
  Effect.gen(function* () {
    const controlPlane =
      yield* Cloudflare.D1.QueryDatabase(ControlPlaneDatabase);
    const rawMessages = yield* Cloudflare.R2.ReadWriteBucket(RawMessagesBucket);
    const authRateLimit = yield* RateLimitDurableObject;
    const isDevelopment = yield* ALCHEMY_DEV;
    const emailSender = isDevelopment
      ? undefined
      : yield* Cloudflare.Email.Send(AuthEmailSender);
    const publicOrigin = yield* Config.string("PUBLIC_ORIGIN").pipe(
      isDevelopment
        ? Config.withDefault("http://localhost:1337")
        : (config) => config
    );
    const emailFrom = Email(
      yield* Config.string("AUTH_EMAIL_FROM").pipe(
        isDevelopment
          ? Config.withDefault("auth@localhost.invalid")
          : (config) => config
      )
    );
    const authSecret = (name: string, purpose: string) =>
      Config.redacted(name).pipe(
        isDevelopment
          ? Config.withDefault(developmentSecret(purpose))
          : (config) => config
      );
    const sessionSecret = yield* authSecret("AUTH_SESSION_SECRET", "session");
    const challengeSecret = yield* authSecret(
      "AUTH_CHALLENGE_SECRET",
      "challenge"
    );
    const privacySecret = yield* authSecret("AUTH_PRIVACY_SECRET", "privacy");
    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const webRequest = yield* Cloudflare.Request;
        const url = new URL(request.url, "http://backend");

        if (request.method === "GET" && url.pathname === "/api/health") {
          const checks = yield* Effect.all(
            {
              authRateLimit: authRateLimit
                .getByName("health")
                .fixedWindow({
                  limit: undefined,
                  refillMillis: 1,
                  tokens: 0,
                })
                .pipe(Effect.exit),
              controlPlane: controlPlane
                .prepare("select 1 as ready")
                .first()
                .pipe(Effect.exit),
              rawMessages: rawMessages.head("__health__").pipe(Effect.exit),
            },
            { concurrency: "unbounded" }
          );
          const storage = {
            authRateLimit: Exit.isSuccess(checks.authRateLimit)
              ? "ok"
              : "error",
            controlPlane: Exit.isSuccess(checks.controlPlane) ? "ok" : "error",
            rawMessages: Exit.isSuccess(checks.rawMessages) ? "ok" : "error",
          } as const;
          const healthy = Object.values(storage).every(
            (status) => status === "ok"
          );

          return yield* HttpServerResponse.json(
            {
              service: "backend",
              status: healthy ? "ok" : "degraded",
              storage,
            },
            { status: healthy ? 200 : 503 }
          );
        }

        if (url.pathname.startsWith("/auth/")) {
          if (
            request.method === "POST" &&
            url.pathname === "/auth/email-otp/start" &&
            (yield* hasCallerProvidedOtpSecret(webRequest))
          ) {
            return yield* HttpServerResponse.json(
              {
                _tag: "AuthBadRequestError",
                code: "bad_request",
                message: "Invalid email OTP request",
              },
              { status: 400 }
            );
          }

          return yield* Effect.scoped(
            Effect.gen(function* () {
              const authHandler = yield* makeAuthHttpApiLive({
                database: yield* controlPlane.raw,
                emailFrom,
                emailSender,
                isDevelopment,
                outboxDatabase: controlPlane,
                publicOrigin,
                rateLimitNamespace: authRateLimit,
                secrets: {
                  challenge: challengeSecret,
                  privacy: privacySecret,
                  session: sessionSecret,
                },
              }).pipe(
                Layer.provide([Etag.layer, HttpPlatformStub, Path.layer]),
                HttpRouter.toHttpEffect
              );

              return yield* authHandler;
            })
          );
        }

        return HttpServerResponse.text("Not found", { status: 404 });
      }),
    };
  }).pipe(
    Effect.provide(Cloudflare.D1.QueryDatabaseBinding),
    Effect.provide(Cloudflare.Email.SendBinding),
    Effect.provide(Cloudflare.R2.ReadWriteBucketBinding)
  )
) {}
