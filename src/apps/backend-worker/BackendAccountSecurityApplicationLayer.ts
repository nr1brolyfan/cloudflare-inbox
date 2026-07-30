import * as Layer from "effect/Layer";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { AccountSecurityHttpLayer } from "#/modules/account-security/layers/AccountSecurityHttpLayer";
import { HttpApiPlatformLayer } from "#/platform/cloudflare/HttpApiPlatform";
import { ControlPlaneD1Layer } from "#/platform/control-plane-d1/ControlPlaneBatch";
import { BackendRequestContextMiddlewareLayer } from "#/platform/observability/BackendRequestContextMiddlewareLayer";

import { BackendAccountSecurityHttpApi } from "./BackendAccountSecurityHttpApi";
import { AdministrativeAuditApplicationRuntimeLayer } from "./BackendSecurityContextLayers";

const AccountSecurityHttpApplicationLayer = AccountSecurityHttpLayer.pipe(
  Layer.provide(AdministrativeAuditApplicationRuntimeLayer),
  Layer.provide(BackendRequestContextMiddlewareLayer)
);

/** Account-security-only runtime for every non-specialized /auth route. */
export const BackendAccountSecurityApplicationLayer = HttpApiBuilder.layer(
  BackendAccountSecurityHttpApi
).pipe(
  Layer.provide(AccountSecurityHttpApplicationLayer),
  Layer.provide(ControlPlaneD1Layer),
  Layer.provide(HttpApiPlatformLayer)
);
