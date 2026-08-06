import { AlchemyCloudflareMailer } from "@effect-auth/core/AlchemyCloudflareEmail";
import { RateLimitStoreDurableObject } from "@effect-auth/core/AlchemyCloudflareRateLimitDurableObject";
import { AuthSecretsLive } from "@effect-auth/core/AuthConfig";
import {
  AuthRateLimitNoopLive,
  AuthRateLimitStandardLive,
} from "@effect-auth/core/AuthRateLimit";
import { ChallengeLive } from "@effect-auth/core/Challenge";
import { WebCryptoLive } from "@effect-auth/core/Crypto";
import { AuthMailerFromDevEmailStoreLive } from "@effect-auth/core/DevEmail";
import { IdentityKindRegistryDefaultLive } from "@effect-auth/core/Identity";
import {
  AuthEmailTemplates,
  AuthMailerLive,
  Mailer,
  makeDefaultAuthEmailTemplates,
} from "@effect-auth/core/Mailer";
import { PrivacyLive } from "@effect-auth/core/Privacy";
import { RateLimiterLive } from "@effect-auth/core/RateLimiter";
import { RuntimeContext } from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RateLimiter as PersistenceRateLimiter } from "effect/unstable/persistence";

import { AuthRuntimeConfig } from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";
import { EffectAuthVerificationStoreD1Layer } from "#/modules/account-security/adapters/d1/AuthMagicLinkStartStorageD1";
import { RecoverySafeIdentityD1Layer } from "#/modules/account-security/adapters/d1/RecoverySafeIdentityD1";
import { AUTH_RATE_LIMIT_DURABLE_OBJECT_PREFIX } from "#/modules/account-security/adapters/effect-auth/AuthRateLimitStorage";
import { MagicLinkStarterLayer } from "#/modules/account-security/adapters/effect-auth/MagicLinkStartEffectAuth";
import { AuthMagicLinkStartHttpRouteLayer } from "#/modules/account-security/adapters/http/AuthMagicLinkStartHttpRoute";
import { ControlPlaneD1Layer } from "#/platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneDatabaseLayer } from "#/platform/control-plane-d1/ControlPlaneDatabase";

const MagicLinkStartCoreLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AuthRuntimeConfig;
    const cryptoLayer = WebCryptoLive();
    const secretsLayer = AuthSecretsLive(config.secrets);
    const challengeLayer = ChallengeLive().pipe(
      Layer.provide(cryptoLayer),
      Layer.provide(secretsLayer),
      Layer.provide(EffectAuthVerificationStoreD1Layer)
    );
    const authMailerLayer = (() => {
      const templatesLayer = Layer.succeed(
        AuthEmailTemplates,
        makeDefaultAuthEmailTemplates()
      );
      if (config.delivery._tag === "development") {
        return AuthMailerFromDevEmailStoreLive({
          from: config.emailFrom,
        }).pipe(
          Layer.provide(templatesLayer),
          Layer.provide(
            Layer.unwrap(
              Effect.promise(
                () =>
                  import("#/modules/account-security/adapters/d1/AccountSecurityStorageD1")
              ).pipe(
                Effect.map(({ DevEmailStoreD1Layer }) =>
                  DevEmailStoreD1Layer.pipe(Layer.provide(ControlPlaneD1Layer))
                )
              )
            )
          )
        );
      }
      const { emailSender } = config.delivery;
      return AuthMailerLive({ from: config.emailFrom }).pipe(
        Layer.provide(templatesLayer),
        Layer.provide(
          Layer.succeed(
            Mailer,
            AlchemyCloudflareMailer.make({
              email: {
                send: (message) =>
                  emailSender
                    .send(message)
                    .pipe(Effect.provide(RuntimeContext.phantom)),
              },
              from: config.emailFrom,
              provider: "cloudflare-email-routing",
            })
          )
        )
      );
    })();
    const privacyLayer = PrivacyLive().pipe(
      Layer.provide(cryptoLayer),
      Layer.provide(secretsLayer)
    );
    const rateLimiterLayer = RateLimiterLive.pipe(
      Layer.provide(PersistenceRateLimiter.layer),
      Layer.provide(
        RateLimitStoreDurableObject.layer({
          namespace: config.rateLimitNamespace,
          prefix: AUTH_RATE_LIMIT_DURABLE_OBJECT_PREFIX,
        })
      )
    );
    const authRateLimitLayer =
      config.delivery._tag === "development"
        ? AuthRateLimitNoopLive
        : AuthRateLimitStandardLive().pipe(
            Layer.provide(rateLimiterLayer),
            Layer.provide(privacyLayer)
          );
    const starterLayer = MagicLinkStarterLayer.pipe(
      Layer.provide(challengeLayer),
      Layer.provide(cryptoLayer),
      Layer.provide(IdentityKindRegistryDefaultLive),
      Layer.provide(authMailerLayer),
      Layer.provide(RecoverySafeIdentityD1Layer)
    );

    return Layer.merge(starterLayer, authRateLimitLayer);
  })
);

/** Memory-bounded graph for POST /auth/magic-link/start. */
export const BackendMagicLinkStartApplicationLayer =
  AuthMagicLinkStartHttpRouteLayer.pipe(
    Layer.provide(MagicLinkStartCoreLayer),
    Layer.provide(ControlPlaneDatabaseLayer)
  );
