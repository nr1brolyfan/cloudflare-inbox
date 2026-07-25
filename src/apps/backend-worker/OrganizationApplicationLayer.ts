import * as Layer from "effect/Layer";

import { MailboxNavigationD1Layer } from "#/modules/organization/adapters/d1/MailboxNavigationD1";

import {
  MailboxAdministrationD1Layer,
  MailboxAdministrationRuntimeLayer,
  OrganizationBootstrapD1Layer,
} from "./MailboxAdministrationD1Integration";

const OrganizationServicesLayer = Layer.merge(
  MailboxAdministrationD1Layer,
  OrganizationBootstrapD1Layer
).pipe(Layer.provide(MailboxAdministrationRuntimeLayer));

/** Organization use cases backed by the existing control-plane D1 registry. */
export const OrganizationLayer = Layer.merge(
  OrganizationServicesLayer,
  MailboxNavigationD1Layer
);
