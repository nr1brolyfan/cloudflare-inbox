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

import { BackendHttpApi } from "./api";

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
  Layer.provide(BackendRequestContextMiddlewareLayer)
);
const accountSecurityHttpLayer = AccountSecurityHttpLayer.pipe(
  Layer.provide(BackendRequestContextMiddlewareLayer)
);
const healthHttpLayer = BackendHealthHttpHandlersLayer.pipe(
  Layer.provide(BackendHealthLayer.pipe(Layer.provide(permissionsLayer)))
);

/** Builds the one Backend API from closed bounded-context HTTP graphs. */
const BackendRoutesLayer = HttpApiBuilder.layer(BackendHttpApi).pipe(
  Layer.provide(
    Layer.mergeAll(accountSecurityHttpLayer, healthHttpLayer, mailboxHttpLayer)
  )
);

/** Complete private Backend HTTP router, including platform response support. */
export const BackendHttpLayer = BackendRoutesLayer.pipe(
  Layer.provide(ControlPlaneD1Layer),
  Layer.provide(HttpApiPlatformLayer)
);
