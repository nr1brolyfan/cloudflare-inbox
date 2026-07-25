import * as Effect from "effect/Effect";

import { mailboxArchiveConfig } from "#/modules/mailbox/contracts/MailboxArchiveConfig";
import { mailboxBootstrapConfig } from "#/modules/organization/contracts/MailboxBootstrapConfig";
import {
  MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID,
  MAIL_DOMAIN_CANONICALIZATION_VERSION,
} from "#/modules/organization/domain/MailDomain";

export interface MailDomainConfigSuccess {
  readonly profileId: typeof MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID;
  readonly version: typeof MAIL_DOMAIN_CANONICALIZATION_VERSION;
}

export const mailDomainConfigPreflight = Effect.gen(function* () {
  const bootstrap = yield* mailboxBootstrapConfig;
  yield* mailboxArchiveConfig(bootstrap.initialDomain);
  return {
    profileId: MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID,
    version: MAIL_DOMAIN_CANONICALIZATION_VERSION,
  } satisfies MailDomainConfigSuccess;
}).pipe(Effect.orDie);
