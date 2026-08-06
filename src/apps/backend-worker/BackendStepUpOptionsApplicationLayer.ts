import { RateLimitStoreDurableObject } from "@effect-auth/core/AlchemyCloudflareRateLimitDurableObject";
import { CustomEvidencePoliciesLive } from "@effect-auth/core/Assurance";
import { AuthSecretsLive } from "@effect-auth/core/AuthConfig";
import { AuthRateLimitStandardLive } from "@effect-auth/core/AuthRateLimit";
import { WebCryptoLive } from "@effect-auth/core/Crypto";
import { PrivacyLive } from "@effect-auth/core/Privacy";
import { RateLimiterLive } from "@effect-auth/core/RateLimiter";
import { SessionCookieLive, SessionsLive } from "@effect-auth/core/Sessions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RateLimiter as PersistenceRateLimiter } from "effect/unstable/persistence";

import { AuthRuntimeConfig } from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";
import { EffectAuthSessionStoreD1Layer } from "#/modules/account-security/adapters/d1/AuthSessionStoreD1";
import { PasskeyAuthenticationIdentityD1Layer } from "#/modules/account-security/adapters/d1/PasskeyAuthenticationIdentityD1";
import { StepUpFactorReaderD1Layer } from "#/modules/account-security/adapters/d1/StepUpFactorReaderD1";
import { AUTH_RATE_LIMIT_DURABLE_OBJECT_PREFIX } from "#/modules/account-security/adapters/effect-auth/AuthRateLimitStorage";
import { AuthStepUpOptionsHttpRouteLayer } from "#/modules/account-security/adapters/http/AuthStepUpOptionsHttpRoute";
import { RequestSessionAuthenticatorEffectAuthLayer } from "#/modules/account-security/adapters/http/RequestSessionAuthentication";
import { externalRecoveryLinkEvidence } from "#/modules/account-security/domain/AccountRecovery";
import { ControlPlaneD1Layer } from "#/platform/control-plane-d1/ControlPlaneBatch";

const StepUpOptionsAuthLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AuthRuntimeConfig;
    const cryptoLayer = WebCryptoLive();
    const secretsLayer = AuthSecretsLive(config.secrets);
    const sessionDependencies = Layer.mergeAll(
      cryptoLayer,
      secretsLayer,
      EffectAuthSessionStoreD1Layer,
      CustomEvidencePoliciesLive([externalRecoveryLinkEvidence.policy]).pipe(
        Layer.orDie
      )
    );
    const sessionsLayer = SessionsLive().pipe(
      Layer.provide(sessionDependencies)
    );
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
    const authRateLimitLayer = AuthRateLimitStandardLive().pipe(
      Layer.provide(rateLimiterLayer),
      Layer.provide(privacyLayer)
    );

    return Layer.mergeAll(
      sessionDependencies,
      sessionsLayer,
      SessionCookieLive(),
      authRateLimitLayer
    );
  })
);

const RequestAuthenticatorLayer =
  RequestSessionAuthenticatorEffectAuthLayer.pipe(
    Layer.provide(StepUpOptionsAuthLayer)
  );

/** Memory-bounded graph for GET /auth/step-up/options. */
export const BackendStepUpOptionsApplicationLayer =
  AuthStepUpOptionsHttpRouteLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        StepUpOptionsAuthLayer,
        PasskeyAuthenticationIdentityD1Layer,
        StepUpFactorReaderD1Layer,
        RequestAuthenticatorLayer
      )
    ),
    Layer.provide(ControlPlaneD1Layer)
  );
