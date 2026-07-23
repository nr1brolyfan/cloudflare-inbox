import * as Layer from "effect/Layer";

import { SensitiveOperationStepUpClockCloudflareLayer } from "#/modules/account-security/adapters/cloudflare/SensitiveOperationStepUpClockCloudflare";
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
      SensitiveOperationStepUpClockCloudflareLayer
    )
  )
);

/** Organization use cases backed by the existing control-plane D1 registry. */
export const OrganizationLayer = Layer.merge(
  MailboxAdministrationLayer,
  MailboxNavigationD1Layer
);
