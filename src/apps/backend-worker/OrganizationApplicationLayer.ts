import * as Layer from "effect/Layer";

import { MailboxNavigationD1Layer } from "#/modules/organization/adapters/d1/MailboxNavigationD1";
import { UserMailboxContactPreferencesD1Layer } from "#/modules/organization/adapters/d1/UserMailboxContactPreferencesD1";

import {
  MailboxAdministrationD1Layer,
  mailboxAdministrationRuntimeLayer,
  OrganizationBootstrapD1Layer,
} from "./MailboxAdministrationD1Integration";
import {
  OrganizationAdministrationD1Layer,
  OrganizationAdministrationRuntimeLayer,
} from "./OrganizationAdministrationD1Integration";

const OrganizationServicesLayer = Layer.merge(
  Layer.merge(MailboxAdministrationD1Layer, OrganizationBootstrapD1Layer).pipe(
    Layer.provide(mailboxAdministrationRuntimeLayer())
  ),
  OrganizationAdministrationD1Layer.pipe(
    Layer.provide(OrganizationAdministrationRuntimeLayer)
  )
);

/** Organization use cases backed by the existing control-plane D1 registry. */
export const OrganizationLayer = Layer.mergeAll(
  OrganizationServicesLayer,
  MailboxNavigationD1Layer,
  UserMailboxContactPreferencesD1Layer
);
