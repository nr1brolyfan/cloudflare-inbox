/* oxlint-disable max-classes-per-file -- The decoded config and its closed error form one boundary contract. */
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { canonicalizeMailDomainV1 } from "#/modules/organization/domain/MailDomain";
import {
  NormalizedEmailAddress,
  normalizeEmailAddressDomain,
} from "#/shared/EmailAddress";
import type { EmailAddress } from "#/shared/EmailAddress";

export const MAILBOX_BOOTSTRAP_OWNER_EMAIL_ALLOWLIST_MAX_LENGTH = 32;
const configJsonMaxLength = 16_384;

export const MailboxBootstrapOwnerEmailAllowlist = Schema.Array(
  NormalizedEmailAddress
).pipe(
  Schema.check(
    Schema.isLengthBetween(
      1,
      MAILBOX_BOOTSTRAP_OWNER_EMAIL_ALLOWLIST_MAX_LENGTH
    ),
    Schema.makeFilter((addresses) =>
      new Set(addresses).size === addresses.length
        ? undefined
        : "owner allowlist entries must be unique"
    )
  )
);
export type MailboxBootstrapOwnerEmailAllowlist = Schema.Schema.Type<
  typeof MailboxBootstrapOwnerEmailAllowlist
>;

export class MailboxBootstrapConfigValue extends Schema.Class<MailboxBootstrapConfigValue>(
  "cloudflare-inbox/MailboxBootstrapConfigValue"
)({
  initialAddress: NormalizedEmailAddress,
  ownerEmailAllowlist: MailboxBootstrapOwnerEmailAllowlist,
}) {}

export class MailboxBootstrapConfigError extends Data.TaggedError(
  "MailboxBootstrapConfigError"
)<{
  readonly reason:
    | "invalid-initial-address"
    | "invalid-owner-allowlist"
    | "missing";
}> {}

export class MailboxBootstrapConfig extends Context.Service<
  MailboxBootstrapConfig,
  MailboxBootstrapConfigValue
>()("cloudflare-inbox/MailboxBootstrapConfig") {}

const canonicalDomain = (address: EmailAddress) =>
  canonicalizeMailDomainV1(address.slice(address.lastIndexOf("@") + 1));

export const parseMailboxBootstrapConfig = (
  configuredOwnerAllowlist: unknown,
  configuredInitialAddress: unknown
): Effect.Effect<MailboxBootstrapConfigValue, MailboxBootstrapConfigError> =>
  Effect.gen(function* () {
    if (
      typeof configuredOwnerAllowlist !== "string" ||
      configuredOwnerAllowlist.length === 0 ||
      typeof configuredInitialAddress !== "string" ||
      configuredInitialAddress.length === 0
    ) {
      return yield* new MailboxBootstrapConfigError({ reason: "missing" });
    }
    if (configuredOwnerAllowlist.length > configJsonMaxLength) {
      return yield* new MailboxBootstrapConfigError({
        reason: "invalid-owner-allowlist",
      });
    }

    const rawAllowlist = yield* Effect.try({
      try: () => JSON.parse(configuredOwnerAllowlist) as unknown,
      catch: () =>
        new MailboxBootstrapConfigError({
          reason: "invalid-owner-allowlist",
        }),
    });
    const ownerEmailAllowlist = yield* Schema.decodeUnknownEffect(
      MailboxBootstrapOwnerEmailAllowlist
    )(rawAllowlist).pipe(
      Effect.mapError(
        () =>
          new MailboxBootstrapConfigError({
            reason: "invalid-owner-allowlist",
          })
      )
    );
    if (
      !Array.isArray(rawAllowlist) ||
      ownerEmailAllowlist.some(
        (address, index) => address !== rawAllowlist[index]
      )
    ) {
      return yield* new MailboxBootstrapConfigError({
        reason: "invalid-owner-allowlist",
      });
    }
    yield* Effect.all(ownerEmailAllowlist.map(canonicalDomain), {
      concurrency: "unbounded",
      discard: true,
    }).pipe(
      Effect.mapError(
        () =>
          new MailboxBootstrapConfigError({
            reason: "invalid-owner-allowlist",
          })
      )
    );

    const decodedInitialAddress = yield* Schema.decodeUnknownEffect(
      NormalizedEmailAddress
    )(configuredInitialAddress).pipe(
      Effect.mapError(
        () =>
          new MailboxBootstrapConfigError({
            reason: "invalid-initial-address",
          })
      )
    );
    const initialAddress = normalizeEmailAddressDomain(decodedInitialAddress);
    if (initialAddress !== configuredInitialAddress) {
      return yield* new MailboxBootstrapConfigError({
        reason: "invalid-initial-address",
      });
    }
    yield* canonicalDomain(initialAddress).pipe(
      Effect.mapError(
        () =>
          new MailboxBootstrapConfigError({
            reason: "invalid-initial-address",
          })
      )
    );

    return new MailboxBootstrapConfigValue({
      initialAddress,
      ownerEmailAllowlist,
    });
  });

export const mailboxBootstrapConfig = Effect.gen(function* () {
  const ownerEmailAllowlist = yield* Config.string(
    "MAILBOX_BOOTSTRAP_OWNER_EMAIL_ALLOWLIST"
  ).pipe(
    Effect.mapError(
      () => new MailboxBootstrapConfigError({ reason: "missing" })
    )
  );
  const initialAddress = yield* Config.string("MAILBOX_INITIAL_ADDRESS").pipe(
    Effect.mapError(
      () => new MailboxBootstrapConfigError({ reason: "missing" })
    )
  );
  return yield* parseMailboxBootstrapConfig(
    ownerEmailAllowlist,
    initialAddress
  );
});
