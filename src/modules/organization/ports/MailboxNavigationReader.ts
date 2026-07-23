import * as Context from "effect/Context";

import type { MailboxNavigationService } from "#/modules/organization/application/MailboxNavigation";

/** Navigation projection supplied by the selected organization persistence adapter. */
export class MailboxNavigationReader extends Context.Service<
  MailboxNavigationReader,
  MailboxNavigationService
>()("cloudflare-inbox/MailboxNavigationReader") {}
