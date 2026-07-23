import * as Layer from "effect/Layer";

import { SensitiveOperationStepUpClockLive } from "#/auth/step-up-policy";
import {
  AdministrativeAuditLayer,
  AdministrativeAuditRuntimeLayer,
} from "#/modules/administrative-audit/layers/AdministrativeAuditLayer";
import {
  MailboxAdministrationD1Layer,
  MailboxAdministrationRuntimeLayer,
} from "#/modules/organization/adapters/d1/MailboxAdministrationD1";
import { MailboxNavigationD1Layer } from "#/modules/organization/adapters/d1/MailboxNavigationD1";

const AdministrativeAuditWithRuntimeLayer = AdministrativeAuditLayer.pipe(
  Layer.provide(AdministrativeAuditRuntimeLayer)
);
const MailboxAdministrationLayer = MailboxAdministrationD1Layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      AdministrativeAuditWithRuntimeLayer,
      MailboxAdministrationRuntimeLayer,
      SensitiveOperationStepUpClockLive
    )
  )
);

/** Organization use cases backed by the existing control-plane D1 registry. */
export const OrganizationLayer = Layer.merge(
  MailboxAdministrationLayer,
  MailboxNavigationD1Layer
);
