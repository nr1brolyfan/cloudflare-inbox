import {
  AuthOriginCheckMiddlewareLive,
  AuthRequestMetadataMiddlewareLive,
  AuthSchemaErrorMiddlewareLive,
} from "@effect-auth/core/HttpApi";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AuthRuntimeConfig } from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";
import {
  CurrentRequestAuthMiddlewareLayer,
  RequestSessionAuthenticatorEffectAuthLayer,
  SessionAuthenticationMiddlewareLayer,
} from "#/modules/account-security/adapters/http/RequestSessionAuthentication";

import { AuthSessionCoreLayer } from "./BackendAuthSessionApplicationLayer";

const RequestSessionAuthenticatorLayer =
  RequestSessionAuthenticatorEffectAuthLayer.pipe(
    Layer.provide(AuthSessionCoreLayer)
  );

/** Shared HTTP security middleware backed only by the session capability. */
export const BackendSessionAuthenticationMiddlewareLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AuthRuntimeConfig;
    const originPolicy = {
      mode: "secure",
      origins: [config.publicOrigin.origin],
    } as const;
    const requestMetadata = {
      ipSource: { _tag: "CloudflareConnectingIp" },
    } as const;

    return Layer.mergeAll(
      AuthSchemaErrorMiddlewareLive,
      AuthOriginCheckMiddlewareLive(originPolicy).pipe(Layer.orDie),
      AuthRequestMetadataMiddlewareLive(requestMetadata).pipe(Layer.orDie),
      CurrentRequestAuthMiddlewareLayer.pipe(
        Layer.provide(RequestSessionAuthenticatorLayer)
      ),
      SessionAuthenticationMiddlewareLayer.pipe(
        Layer.provide(RequestSessionAuthenticatorLayer)
      )
    );
  })
);
