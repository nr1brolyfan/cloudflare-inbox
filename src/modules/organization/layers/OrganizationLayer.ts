import * as Layer from "effect/Layer";

import {
  MailboxAdministrationD1Layer,
  MailboxAdministrationRuntimeLayer,
} from "#/modules/organization/adapters/d1/MailboxAdministrationD1";
import { MailboxNavigationD1Layer } from "#/modules/organization/adapters/d1/MailboxNavigationD1";

const MailboxAdministrationLayer = MailboxAdministrationD1Layer.pipe(
  Layer.provide(MailboxAdministrationRuntimeLayer)
);

/** Organization use cases backed by the existing control-plane D1 registry. */
export const OrganizationLayer = Layer.merge(
  MailboxAdministrationLayer,
  MailboxNavigationD1Layer
);
