import { RateLimitDurableObject } from "@effect-auth/core/AlchemyCloudflareRateLimitDurableObject";
import { Email } from "@effect-auth/core/Identifiers";
import { ALCHEMY_DEV } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRespondable from "effect/unstable/http/HttpServerRespondable";

import { BackendHttpLive } from "../http/backend";
import { BackendAuthConfig, BackendResources } from "../http/backend-context";
import {
  AuthEmailSender,
  ControlPlaneDatabase,
  RawMessagesBucket,
} from "../infra/resources";

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
    const publicOrigin = yield* Config.string("PUBLIC_ORIGIN");
    const emailFrom = Email(yield* Config.string("AUTH_EMAIL_FROM"));
    const mailboxOwnerEmail = yield* Config.string("MAILBOX_OWNER_EMAIL");
    const sessionSecret = yield* Config.redacted("AUTH_SESSION_SECRET");
    const challengeSecret = yield* Config.redacted("AUTH_CHALLENGE_SECRET");
    const privacySecret = yield* Config.redacted("AUTH_PRIVACY_SECRET");
    const authConfigLive = Layer.succeed(
      BackendAuthConfig,
      BackendAuthConfig.of({
        emailFrom,
        isDevelopment,
        mailboxOwnerEmail,
        publicOrigin,
        secrets: {
          challenge: challengeSecret,
          privacy: privacySecret,
          session: sessionSecret,
        },
      })
    );
    return {
      fetch: Effect.gen(function* () {
        const controlPlaneDatabase = yield* controlPlane.raw;
        const routesLive = BackendHttpLive.pipe(
          Layer.provide(
            Layer.succeed(
              BackendResources,
              BackendResources.of({
                authRateLimit,
                controlPlane,
                database: controlPlaneDatabase,
                emailSender,
                rawMessages,
              })
            )
          ),
          Layer.provide(authConfigLive)
        );
        const handler = yield* HttpRouter.toHttpEffect(routesLive);

        return yield* handler.pipe(
          Effect.catchTag("HttpServerError", HttpServerRespondable.toResponse)
        );
      }),
    };
  }).pipe(
    Effect.provide(Cloudflare.D1.QueryDatabaseBinding),
    Effect.provide(Cloudflare.Email.SendBinding),
    Effect.provide(Cloudflare.R2.ReadWriteBucketBinding)
  )
) {}
