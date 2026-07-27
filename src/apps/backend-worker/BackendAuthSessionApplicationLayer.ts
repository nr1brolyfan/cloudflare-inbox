import { CustomEvidencePoliciesLive } from "@effect-auth/core/Assurance";
import { AuthSecretsLive } from "@effect-auth/core/AuthConfig";
import { WebCryptoLive } from "@effect-auth/core/Crypto";
import { SessionCookieLive, SessionsLive } from "@effect-auth/core/Sessions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AuthRuntimeConfig } from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";
import { EffectAuthSessionStoreD1Layer } from "#/modules/account-security/adapters/d1/AuthSessionStoreD1";
import { AuthCurrentSessionHttpRouteLayer } from "#/modules/account-security/adapters/http/AuthCurrentSessionHttpRoute";
import { externalRecoveryLinkEvidence } from "#/modules/account-security/domain/AccountRecovery";
import { ControlPlaneDatabaseLayer } from "#/platform/control-plane-d1/ControlPlaneDatabase";

const AuthSessionCoreLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AuthRuntimeConfig;
    const sessionDependencies = Layer.mergeAll(
      AuthSecretsLive(config.secrets),
      WebCryptoLive(),
      EffectAuthSessionStoreD1Layer,
      CustomEvidencePoliciesLive([externalRecoveryLinkEvidence.policy]).pipe(
        Layer.orDie
      )
    );

    return Layer.merge(
      SessionsLive().pipe(Layer.provide(sessionDependencies)),
      SessionCookieLive()
    );
  })
);

/** Minimal graph for GET /auth/session, isolated from unrelated auth features. */
export const BackendAuthSessionApplicationLayer =
  AuthCurrentSessionHttpRouteLayer.pipe(
    Layer.provide(AuthSessionCoreLayer),
    Layer.provide(ControlPlaneDatabaseLayer)
  );
