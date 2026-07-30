import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { SensitiveOperationStepUpClockCloudflareLayer } from "#/modules/account-security/adapters/cloudflare/SensitiveOperationStepUpClockCloudflare";
import { AddressRoutingLayer } from "#/modules/address-routing/layers/AddressRoutingLayer";
import { MailboxAuthorizationLayer } from "#/modules/authorization/layers/MailboxAuthorizationLayer";
import { TrustedMailResourceTransport } from "#/modules/authorization/ports/TrustedMailResourceTransport";
import {
  MailboxDoClient,
  MailboxDoClientLayer,
} from "#/modules/mailbox/adapters/durable-object/MailboxDoClient";
import { MailboxDirectoryRepositoryDoLayer } from "#/modules/mailbox/adapters/durable-object/MailboxRepositoryDo";
import { MailboxRegistryD1Layer } from "#/modules/organization/adapters/d1/MailboxRegistryD1";
import { HttpApiPlatformLayer } from "#/platform/cloudflare/HttpApiPlatform";
import { ControlPlaneD1Layer } from "#/platform/control-plane-d1/ControlPlaneBatch";
import { BackendRequestContextMiddlewareLayer } from "#/platform/observability/BackendRequestContextMiddlewareLayer";

import { MailboxHttpApi } from "./BackendMailboxHttpApi";
import { MailboxHttpLayer } from "./BackendMailboxHttpLayer";
import {
  AdministrativeAuditApplicationRuntimeLayer,
  PermissionsApplicationLayer,
} from "./BackendSecurityContextLayers";
import { BackendSessionAuthenticationMiddlewareLayer } from "./BackendSessionAuthenticationMiddlewareLayer";
import { OrganizationLayer } from "./OrganizationApplicationLayer";

const MailboxDoClientApplicationLayer = MailboxDoClientLayer.pipe(
  Layer.provide(MailboxRegistryD1Layer)
);
const MailboxDirectoryApplicationLayer = MailboxDirectoryRepositoryDoLayer.pipe(
  Layer.provide(MailboxDoClientApplicationLayer)
);
const TrustedMailResourceTransportLayer = Layer.effect(
  TrustedMailResourceTransport,
  Effect.gen(function* () {
    const client = yield* MailboxDoClient;
    return TrustedMailResourceTransport.of({
      resolve: client.resolveMailResource,
    });
  })
).pipe(Layer.provide(MailboxDoClientApplicationLayer));
const MailboxAuthorizationApplicationLayer = MailboxAuthorizationLayer.pipe(
  Layer.provide(TrustedMailResourceTransportLayer),
  Layer.provide(PermissionsApplicationLayer)
);
const OrganizationApplicationLayer = OrganizationLayer.pipe(
  Layer.provide(MailboxDirectoryApplicationLayer),
  Layer.provide(MailboxAuthorizationApplicationLayer),
  Layer.provide(AdministrativeAuditApplicationRuntimeLayer),
  Layer.provide(SensitiveOperationStepUpClockCloudflareLayer)
);
const AccountSecurityHttpMiddlewareApplicationLayer =
  BackendSessionAuthenticationMiddlewareLayer;
const MailboxHttpApplicationLayer = MailboxHttpLayer.pipe(
  Layer.provide(MailboxDoClientApplicationLayer),
  Layer.provide(AddressRoutingLayer),
  Layer.provide(OrganizationApplicationLayer),
  Layer.provide(MailboxAuthorizationApplicationLayer),
  Layer.provide(PermissionsApplicationLayer),
  Layer.provide(AccountSecurityHttpMiddlewareApplicationLayer),
  Layer.provide(BackendRequestContextMiddlewareLayer)
);

/** Mailbox-only runtime, excluding account-security and organization HTTP graphs. */
export const BackendMailboxApplicationLayer = HttpApiBuilder.layer(
  MailboxHttpApi
).pipe(
  Layer.provide(MailboxHttpApplicationLayer),
  Layer.provide(ControlPlaneD1Layer),
  Layer.provide(HttpApiPlatformLayer)
);
