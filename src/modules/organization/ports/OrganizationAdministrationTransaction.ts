import * as Context from "effect/Context";

import type { OrganizationAdministrationService } from "#/modules/organization/application/OrganizationAdministration";

/** Organization lifecycle writes with in-transaction session and authority checks. */
export class OrganizationAdministrationTransaction extends Context.Service<
  OrganizationAdministrationTransaction,
  OrganizationAdministrationService
>()("cloudflare-inbox/OrganizationAdministrationTransaction") {}
