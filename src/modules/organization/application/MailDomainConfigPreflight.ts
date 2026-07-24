import * as Config from "effect/Config";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID,
  MAIL_DOMAIN_CANONICALIZATION_VERSION,
  canonicalizeMailDomainV1,
} from "#/modules/organization/domain/MailDomain";
import { EmailAddress } from "#/shared/EmailAddress";

export class MailDomainConfigError extends Data.TaggedError(
  "MailDomainConfigError"
)<{
  readonly reason: "invalid-domain" | "invalid-email" | "missing";
}> {}

export interface MailDomainConfigSuccess {
  readonly profileId: typeof MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID;
  readonly version: typeof MAIL_DOMAIN_CANONICALIZATION_VERSION;
}

// ORG-009 will add persisted D1 comparison; this deploy preflight validates configuration only.
export const checkMailDomainConfig = (
  configuredOwnerEmail: unknown
): Effect.Effect<MailDomainConfigSuccess, MailDomainConfigError> =>
  Effect.gen(function* () {
    if (
      typeof configuredOwnerEmail !== "string" ||
      configuredOwnerEmail.length === 0
    ) {
      return yield* new MailDomainConfigError({ reason: "missing" });
    }
    const address = yield* Schema.decodeUnknownEffect(EmailAddress)(
      configuredOwnerEmail
    ).pipe(
      Effect.mapError(
        () => new MailDomainConfigError({ reason: "invalid-email" })
      )
    );
    const separator = address.lastIndexOf("@");
    yield* canonicalizeMailDomainV1(address.slice(separator + 1)).pipe(
      Effect.mapError(
        () => new MailDomainConfigError({ reason: "invalid-domain" })
      )
    );
    return {
      profileId: MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID,
      version: MAIL_DOMAIN_CANONICALIZATION_VERSION,
    };
  });

export const mailDomainConfigPreflight = Config.string(
  "MAILBOX_OWNER_EMAIL"
).pipe(
  Effect.mapError(() => new MailDomainConfigError({ reason: "missing" })),
  Effect.flatMap(checkMailDomainConfig),
  Effect.orDie
);
