import * as Layer from "effect/Layer";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { EffectAuthStorageD1Layer } from "#/modules/account-security/adapters/d1/AccountSecurityStorageD1";
import { MailPermissionsEffectAuthLayer } from "#/modules/authorization/adapters/effect-auth/MailPermissionsEffectAuth";
import { HttpApiPlatformLayer } from "#/platform/cloudflare/HttpApiPlatform";
import { ControlPlaneD1Layer } from "#/platform/control-plane-d1/ControlPlaneBatch";
import { BackendHealthHttpApi } from "#/platform/observability/http/BackendHealthHttpApi";
import { BackendHealthHttpHandlersLayer } from "#/platform/observability/http/BackendHealthHttpHandlers";

import { BackendHealthLayer } from "./BackendHealthLayer";

const PermissionsApplicationLayer = MailPermissionsEffectAuthLayer.pipe(
  Layer.provide(EffectAuthStorageD1Layer)
);
const HealthHttpApplicationLayer = BackendHealthHttpHandlersLayer.pipe(
  Layer.provide(
    BackendHealthLayer.pipe(Layer.provide(PermissionsApplicationLayer))
  )
);

/** Health-only graph kept separate from business request graphs. */
export const BackendHealthApplicationLayer = HttpApiBuilder.layer(
  BackendHealthHttpApi
).pipe(
  Layer.provide(HealthHttpApplicationLayer),
  Layer.provide(ControlPlaneD1Layer),
  Layer.provide(HttpApiPlatformLayer)
);
