import * as Layer from "effect/Layer";

import { MailboxNavigationD1Layer } from "#/modules/organization/adapters/d1/MailboxNavigationD1";

import {
  MailboxAdministrationD1Layer,
  MailboxAdministrationRuntimeLayer,
} from "./MailboxAdministrationD1Integration";

const MailboxAdministrationLayer = MailboxAdministrationD1Layer.pipe(
  Layer.provide(MailboxAdministrationRuntimeLayer)
);

/** Organization use cases backed by the existing control-plane D1 registry. */
export const OrganizationLayer = Layer.merge(
  MailboxAdministrationLayer,
  MailboxNavigationD1Layer
);
