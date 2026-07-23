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
import { BackendHealthLive } from "#/observability/backend-health-live";
import { BackendRequestContextMiddlewareLive } from "#/observability/backend-request-live";
import { ControlPlaneD1Layer } from "#/platform/control-plane-d1/ControlPlaneBatch";

import { BackendHttpApi } from "./api";
import { HealthGroupLive } from "./health";
import { HttpApiPlatformLive } from "./platform";

/** Builds the one Backend API from closed bounded-context HTTP graphs. */
const accountSecurityLayer = AccountSecurityLayer;
const permissionsLayer = MailPermissionsEffectAuthLayer.pipe(
  Layer.provide(accountSecurityLayer)
);
const mailboxDoClientLayer = MailboxDoClientLayer.pipe(
  Layer.provide(MailboxRegistryD1Layer)
);
const mailboxAuthorizationLayer = MailboxAuthorizationLayer.pipe(
  Layer.provide(mailboxDoClientLayer)
);
const mailboxHttpLayer = MailboxHttpLayer.pipe(
  Layer.provide(mailboxAuthorizationLayer),
  Layer.provide(permissionsLayer),
  Layer.provide(AccountSecurityHttpMiddlewareLayer),
  Layer.provide(BackendRequestContextMiddlewareLive)
);
const healthHttpLayer = HealthGroupLive.pipe(
  Layer.provide(BackendHealthLive.pipe(Layer.provide(permissionsLayer)))
);

/** Builds the one Backend API from closed bounded-context HTTP graphs. */
const BackendRoutesLayer = HttpApiBuilder.layer(BackendHttpApi).pipe(
  Layer.provide(
    Layer.mergeAll(AccountSecurityHttpLayer, healthHttpLayer, mailboxHttpLayer)
  )
);

/** Complete private Backend HTTP router, including platform response support. */
export const BackendHttpLayer = BackendRoutesLayer.pipe(
  Layer.provide(ControlPlaneD1Layer),
  Layer.provide(HttpApiPlatformLive)
);
