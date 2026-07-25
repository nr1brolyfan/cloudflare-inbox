/* oxlint-disable max-classes-per-file -- The private decoded value and value-free error form one config boundary. */
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { toASCII } from "tr46";

import { NormalizedEmailAddress } from "#/shared/EmailAddress";

export const MailboxArchiveRecipient = NormalizedEmailAddress.pipe(
  Schema.check(
    Schema.makeFilter((recipient) => {
      const domain = recipient.slice(recipient.lastIndexOf("@") + 1);
      const labels = domain.split(".");
      const canonical = toASCII(domain, {
        checkBidi: true,
        checkHyphens: true,
        checkJoiners: true,
        ignoreInvalidPunycode: false,
        transitionalProcessing: false,
        useSTD3ASCIIRules: true,
        verifyDNSLength: true,
      });
      const ipv4 =
        labels.length === 4 &&
        labels.every(
          (label) =>
            /^(?:0|[1-9][0-9]{0,2})$/u.test(label) && Number(label) <= 255
        );
      return canonical === domain &&
        !ipv4 &&
        !/^[0-9]+$/u.test(labels.at(-1) ?? "")
        ? undefined
        : "must contain a canonical mail domain";
    })
  ),
  Schema.brand("cloudflare-inbox/MailboxArchiveRecipient")
);
export type MailboxArchiveRecipient = Schema.Schema.Type<
  typeof MailboxArchiveRecipient
>;

export class MailboxArchiveConfigValue extends Schema.Class<MailboxArchiveConfigValue>(
  "cloudflare-inbox/MailboxArchiveConfigValue"
)({
  recipient: MailboxArchiveRecipient,
}) {}

export class MailboxArchiveConfigError extends Data.TaggedError(
  "MailboxArchiveConfigError"
)<{
  readonly reason: "invalid-recipient" | "managed-domain" | "missing";
}> {}

export class MailboxArchiveConfig extends Context.Service<
  MailboxArchiveConfig,
  MailboxArchiveConfigValue
>()("cloudflare-inbox/MailboxArchiveConfig") {}

export const parseMailboxArchiveConfig = (
  configuredRecipient: unknown,
  initialDomain: string
): Effect.Effect<MailboxArchiveConfigValue, MailboxArchiveConfigError> =>
  Effect.gen(function* () {
    if (
      typeof configuredRecipient !== "string" ||
      configuredRecipient.length === 0
    ) {
      return yield* new MailboxArchiveConfigError({ reason: "missing" });
    }
    const recipient = yield* Schema.decodeUnknownEffect(
      MailboxArchiveRecipient
    )(configuredRecipient).pipe(
      Effect.mapError(
        () => new MailboxArchiveConfigError({ reason: "invalid-recipient" })
      )
    );
    if (recipient !== configuredRecipient) {
      return yield* new MailboxArchiveConfigError({
        reason: "invalid-recipient",
      });
    }
    const domain = recipient.slice(recipient.lastIndexOf("@") + 1);
    if (domain === initialDomain) {
      return yield* new MailboxArchiveConfigError({ reason: "managed-domain" });
    }
    return new MailboxArchiveConfigValue({ recipient });
  });

export const mailboxArchiveConfig = (initialDomain: string) =>
  Effect.gen(function* () {
    const recipient = yield* Config.string("MAILBOX_ARCHIVE_RECIPIENT").pipe(
      Effect.mapError(
        () => new MailboxArchiveConfigError({ reason: "missing" })
      )
    );
    return yield* parseMailboxArchiveConfig(recipient, initialDomain);
  });
