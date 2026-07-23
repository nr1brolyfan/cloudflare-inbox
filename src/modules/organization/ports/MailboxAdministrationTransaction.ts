import * as Context from "effect/Context";

import type { MailboxAdministrationService } from "#/modules/organization/application/MailboxAdministration";

/** Atomic mailbox administration supplied by persistence adapters. */
export class MailboxAdministrationTransaction extends Context.Service<
  MailboxAdministrationTransaction,
  MailboxAdministrationService
>()("cloudflare-inbox/MailboxAdministrationTransaction") {}
