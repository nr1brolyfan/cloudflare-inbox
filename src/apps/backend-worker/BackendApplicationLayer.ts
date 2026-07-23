import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { SensitiveOperationStepUpClockCloudflareLayer } from "#/modules/account-security/adapters/cloudflare/SensitiveOperationStepUpClockCloudflare";
import {
  AccountSecurityHttpLayer,
  AccountSecurityHttpMiddlewareLayer,
} from "#/modules/account-security/layers/AccountSecurityHttpLayer";
import { AccountSecurityLayer } from "#/modules/account-security/layers/AccountSecurityLayer";
import { AddressRoutingLayer } from "#/modules/address-routing/layers/AddressRoutingLayer";
import {
  AdministrativeAuditApplicationLayer,
  AdministrativeAuditRuntimeLayer,
} from "#/modules/administrative-audit/layers/AdministrativeAuditLayer";
import { MailPermissionsEffectAuthLayer } from "#/modules/authorization/adapters/effect-auth/MailPermissionsEffectAuth";
import { MailboxAuthorizationLayer } from "#/modules/authorization/layers/MailboxAuthorizationLayer";
import { TrustedMailResourceTransport } from "#/modules/authorization/ports/TrustedMailResourceTransport";
import {
  MailboxDoClient,
  MailboxDoClientLayer,
} from "#/modules/mailbox/adapters/durable-object/MailboxDoClient";
import { MailboxDirectoryRepositoryDoLayer } from "#/modules/mailbox/adapters/durable-object/MailboxRepositoryDo";
import { MailboxHttpLayer } from "#/modules/mailbox/layers/MailboxHttpLayer";
import { MailboxRegistryD1Layer } from "#/modules/organization/adapters/d1/MailboxRegistryD1";
import { OrganizationLayer } from "#/modules/organization/layers/OrganizationLayer";
import { HttpApiPlatformLayer } from "#/platform/cloudflare/HttpApiPlatform";
import { ControlPlaneD1Layer } from "#/platform/control-plane-d1/ControlPlaneBatch";
import { BackendRequestContextMiddlewareLayer } from "#/platform/observability/BackendRequestContextMiddlewareLayer";
import { BackendHealthHttpHandlersLayer } from "#/platform/observability/http/BackendHealthHttpHandlers";

import { BackendHealthLayer } from "./BackendHealthLayer";
import { BackendHttpApi } from "./BackendHttpApi";

/** Builds the one Backend API from closed bounded-context HTTP graphs. */
const AdministrativeAuditApplicationRuntimeLayer =
  AdministrativeAuditApplicationLayer.pipe(
    Layer.provide(AdministrativeAuditRuntimeLayer)
  );
const AccountSecurityApplicationLayer = AccountSecurityLayer.pipe(
  Layer.provide(AdministrativeAuditApplicationRuntimeLayer)
);
const PermissionsApplicationLayer = MailPermissionsEffectAuthLayer.pipe(
  Layer.provide(AccountSecurityApplicationLayer)
);
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
  AccountSecurityHttpMiddlewareLayer.pipe(
    Layer.provide(AdministrativeAuditApplicationRuntimeLayer)
  );
const MailboxHttpApplicationLayer = MailboxHttpLayer.pipe(
  Layer.provide(MailboxDoClientApplicationLayer),
  Layer.provide(AddressRoutingLayer),
  Layer.provide(OrganizationApplicationLayer),
  Layer.provide(MailboxAuthorizationApplicationLayer),
  Layer.provide(PermissionsApplicationLayer),
  Layer.provide(AccountSecurityHttpMiddlewareApplicationLayer),
  Layer.provide(BackendRequestContextMiddlewareLayer)
);
const AccountSecurityHttpApplicationLayer = AccountSecurityHttpLayer.pipe(
  Layer.provide(AdministrativeAuditApplicationRuntimeLayer),
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
