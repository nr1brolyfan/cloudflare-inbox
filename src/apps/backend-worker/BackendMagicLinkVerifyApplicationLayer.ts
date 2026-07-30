import * as Layer from "effect/Layer";

import {
  DevEmailStoreD1Layer,
  EffectAuthStorageD1Layer,
} from "#/modules/account-security/adapters/d1/AccountSecurityStorageD1";
import { AccountSecurityEffectAuthLayer } from "#/modules/account-security/adapters/effect-auth/AccountSecurityEffectAuth";
import { AuthMagicLinkVerifyHttpRouteLayer } from "#/modules/account-security/adapters/http/AuthMagicLinkVerifyHttpRoute";
import { ControlPlaneD1Layer } from "#/platform/control-plane-d1/ControlPlaneBatch";

/** Auth-only graph for POST /auth/magic-link/verify. */
export const BackendMagicLinkVerifyApplicationLayer =
  AuthMagicLinkVerifyHttpRouteLayer.pipe(
    Layer.provide(AccountSecurityEffectAuthLayer),
    Layer.provide(EffectAuthStorageD1Layer),
    Layer.provide(DevEmailStoreD1Layer),
    Layer.provide(ControlPlaneD1Layer)
  );
