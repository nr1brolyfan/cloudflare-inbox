import * as Layer from "effect/Layer";

import { MailboxNavigationD1Layer } from "#/modules/organization/adapters/d1/MailboxNavigationD1";

import {
  MailboxAdministrationD1Layer,
  MailboxAdministrationRuntimeLayer,
  OrganizationBootstrapD1Layer,
} from "./MailboxAdministrationD1Integration";
import {
  OrganizationAdministrationD1Layer,
  OrganizationAdministrationRuntimeLayer,
} from "./OrganizationAdministrationD1Integration";

const OrganizationServicesLayer = Layer.merge(
  Layer.merge(MailboxAdministrationD1Layer, OrganizationBootstrapD1Layer).pipe(
    Layer.provide(MailboxAdministrationRuntimeLayer)
  ),
  OrganizationAdministrationD1Layer.pipe(
    Layer.provide(OrganizationAdministrationRuntimeLayer)
  )
);

/** Organization use cases backed by the existing control-plane D1 registry. */
export const OrganizationLayer = Layer.merge(
  OrganizationServicesLayer,
  MailboxNavigationD1Layer
);
