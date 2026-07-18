import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { makeAuthHttpApiLive } from "../auth/live";
import { makeMailAuthorizationLive } from "../authorization/live";
import { BackendAuthConfig, BackendResources } from "./backend-context";
import { BackendHealthLive } from "./backend-health";
import * as Health from "./health";
import { HttpApiPlatformLive } from "./platform";

const AuthorizationLive = Layer.unwrap(
  Effect.gen(function* () {
    const resources = yield* BackendResources;
    return makeMailAuthorizationLive(resources.database);
  })
);

const AuthHttpLive = Layer.unwrap(
  Effect.gen(function* () {
    const resources = yield* BackendResources;
    const authConfig = yield* BackendAuthConfig;

    return makeAuthHttpApiLive({
      database: resources.database,
      emailFrom: authConfig.emailFrom,
      emailSender: resources.emailSender,
      isDevelopment: authConfig.isDevelopment,
      outboxDatabase: resources.controlPlane,
      publicOrigin: authConfig.publicOrigin,
      rateLimitNamespace: resources.authRateLimit,
      secrets: authConfig.secrets,
    });
  })
);

const HealthHttpLive = Health.HealthHttpLive.pipe(
  Layer.provide(BackendHealthLive.pipe(Layer.provide(AuthorizationLive)))
);

export const BackendHttpLive = Layer.merge(HealthHttpLive, AuthHttpLive).pipe(
  Layer.provide(HttpApiPlatformLive)
);
