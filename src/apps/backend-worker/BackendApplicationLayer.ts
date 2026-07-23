import * as Layer from "effect/Layer";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import {
  AccountSecurityHttpLayer,
  AccountSecurityHttpMiddlewareLayer,
} from "#/modules/account-security/layers/AccountSecurityHttpLayer";
import { AccountSecurityLayer } from "#/modules/account-security/layers/AccountSecurityLayer";
import { MailPermissionsEffectAuthLayer } from "#/modules/authorization/adapters/effect-auth/MailPermissionsEffectAuth";
import { MailboxAuthorizationLayer } from "#/modules/authorization/layers/MailboxAuthorizationLayer";
import { MailboxDoClientLayer } from "#/modules/mailbox/adapters/durable-object/MailboxDoClient";
import { MailboxHttpLayer } from "#/modules/mailbox/layers/MailboxHttpLayer";
import { MailboxRegistryD1Layer } from "#/modules/organization/adapters/d1/MailboxRegistryD1";
import { HttpApiPlatformLayer } from "#/platform/cloudflare/HttpApiPlatform";
import { ControlPlaneD1Layer } from "#/platform/control-plane-d1/ControlPlaneBatch";
import { BackendHealthLayer } from "#/platform/observability/BackendHealthLayer";
import { BackendRequestContextMiddlewareLayer } from "#/platform/observability/BackendRequestContextMiddlewareLayer";
import { BackendHealthHttpHandlersLayer } from "#/platform/observability/http/BackendHealthHttpHandlers";

import { BackendHttpApi } from "./BackendHttpApi";

/** Builds the one Backend API from closed bounded-context HTTP graphs. */
const AccountSecurityApplicationLayer = AccountSecurityLayer;
const PermissionsApplicationLayer = MailPermissionsEffectAuthLayer.pipe(
  Layer.provide(AccountSecurityApplicationLayer)
);
const MailboxDoClientApplicationLayer = MailboxDoClientLayer.pipe(
  Layer.provide(MailboxRegistryD1Layer)
);
const MailboxAuthorizationApplicationLayer = MailboxAuthorizationLayer.pipe(
  Layer.provide(MailboxDoClientApplicationLayer)
);
const MailboxHttpApplicationLayer = MailboxHttpLayer.pipe(
  Layer.provide(MailboxAuthorizationApplicationLayer),
  Layer.provide(PermissionsApplicationLayer),
  Layer.provide(AccountSecurityHttpMiddlewareLayer),
  Layer.provide(BackendRequestContextMiddlewareLayer)
);
const AccountSecurityHttpApplicationLayer = AccountSecurityHttpLayer.pipe(
  Layer.provide(BackendRequestContextMiddlewareLayer)
);
const HealthHttpApplicationLayer = BackendHealthHttpHandlersLayer.pipe(
  Layer.provide(
    BackendHealthLayer.pipe(Layer.provide(PermissionsApplicationLayer))
  )
);

/** Complete private Backend application, built by the sole final API builder. */
export const BackendApplicationLayer = HttpApiBuilder.layer(
  BackendHttpApi
).pipe(
  Layer.provide(
    Layer.mergeAll(
      AccountSecurityHttpApplicationLayer,
      HealthHttpApplicationLayer,
      MailboxHttpApplicationLayer
    )
  ),
  Layer.provide(ControlPlaneD1Layer),
  Layer.provide(HttpApiPlatformLayer)
);
