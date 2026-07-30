import * as Layer from "effect/Layer";

import { PermissionStoreD1Layer } from "#/modules/account-security/adapters/d1/PermissionStoreD1";
import { AdministrativeAudit } from "#/modules/administrative-audit/contracts/AdministrativeAudit";
import { AdministrativeAuditRuntimeLayer } from "#/modules/administrative-audit/layers/AdministrativeAuditLayer";
import { MailPermissionsEffectAuthLayer } from "#/modules/authorization/adapters/effect-auth/MailPermissionsEffectAuth";

export const AdministrativeAuditApplicationRuntimeLayer =
  AdministrativeAudit.layerNoDeps.pipe(
    Layer.provide(AdministrativeAuditRuntimeLayer)
  );
export const PermissionsApplicationLayer = MailPermissionsEffectAuthLayer.pipe(
  Layer.provide(PermissionStoreD1Layer)
);
