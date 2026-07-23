import { UserIdSchema } from "@effect-auth/core/Identifiers";
import * as Schema from "effect/Schema";

import {
  EmailAddress,
  NormalizedEmailAddress,
  normalizeEmailAddressDomain,
} from "#/modules/address-routing/domain/EmailAddress";
import { Version } from "#/modules/mailbox/domain/Mailbox";
import { UnixMillis } from "#/shared/Temporal";

const RecoveryResourceId = Schema.Trimmed.pipe(
  Schema.check(Schema.isLengthBetween(1, 128))
);

export const ExternalRecoveryIdentityId = RecoveryResourceId.pipe(
  Schema.brand("cloudflare-inbox/ExternalRecoveryIdentityId")
);
export type ExternalRecoveryIdentityId = Schema.Schema.Type<
  typeof ExternalRecoveryIdentityId
>;

export const ExternalRecoveryAddressComparisonKey = EmailAddress.pipe(
  Schema.check(
    Schema.makeFilter<EmailAddress>((value) =>
      value === value.toLowerCase()
        ? undefined
        : "must be a lowercase recovery-address comparison key"
    )
  ),
  Schema.brand("cloudflare-inbox/ExternalRecoveryAddressComparisonKey")
);
export type ExternalRecoveryAddressComparisonKey = Schema.Schema.Type<
  typeof ExternalRecoveryAddressComparisonKey
>;

export const externalRecoveryAddressComparisonKey = (
  address: EmailAddress
): ExternalRecoveryAddressComparisonKey =>
  Schema.decodeUnknownSync(ExternalRecoveryAddressComparisonKey)(
    address.toLowerCase()
  );

export const PendingExternalRecoveryIdentityState = Schema.Struct({
  _tag: Schema.Literal("Pending"),
  challengeExpiresAt: UnixMillis,
});

export const VerifiedExternalRecoveryIdentityState = Schema.Struct({
  _tag: Schema.Literal("Verified"),
  verifiedAt: UnixMillis,
});

export const RevokedExternalRecoveryIdentityState = Schema.Struct({
  _tag: Schema.Literal("Revoked"),
  revokedAt: UnixMillis,
  verifiedAt: Schema.optional(UnixMillis),
});

export const ExternalRecoveryIdentityAddress = Schema.Struct({
  address: EmailAddress,
  comparisonKey: ExternalRecoveryAddressComparisonKey,
  normalizedAddress: NormalizedEmailAddress,
}).pipe(
  Schema.check(
    Schema.makeFilter((value) =>
      value.normalizedAddress === normalizeEmailAddressDomain(value.address) &&
      value.comparisonKey ===
        externalRecoveryAddressComparisonKey(value.address)
        ? undefined
        : "recovery address projections must use canonical normalization"
    )
  )
);

export class ExternalRecoveryIdentity extends Schema.Class<ExternalRecoveryIdentity>(
  "cloudflare-inbox/ExternalRecoveryIdentity"
)({
  createdAt: UnixMillis,
  email: ExternalRecoveryIdentityAddress,
  id: ExternalRecoveryIdentityId,
  state: Schema.Union([
    PendingExternalRecoveryIdentityState,
    VerifiedExternalRecoveryIdentityState,
    RevokedExternalRecoveryIdentityState,
  ]),
  updatedAt: UnixMillis,
  userId: UserIdSchema,
  version: Version,
}) {}

export const ExternalRecoveryIdentitySchema = ExternalRecoveryIdentity.check(
  Schema.makeFilter((identity) => {
    if (identity.updatedAt < identity.createdAt) {
      return "recovery identity cannot be updated before creation";
    }
    if (identity.state._tag === "Pending") {
      return identity.state.challengeExpiresAt > identity.createdAt
        ? undefined
        : "recovery challenge must expire after identity creation";
    }
    if (identity.state._tag === "Verified") {
      return identity.state.verifiedAt >= identity.createdAt &&
        identity.state.verifiedAt <= identity.updatedAt
        ? undefined
        : "recovery verification must occur during the identity lifecycle";
    }
    return identity.state.revokedAt >= identity.createdAt &&
      identity.state.revokedAt <= identity.updatedAt &&
      (identity.state.verifiedAt === undefined ||
        (identity.state.verifiedAt >= identity.createdAt &&
          identity.state.verifiedAt <= identity.state.revokedAt))
      ? undefined
      : "recovery revocation must occur after creation and verification";
  })
);

export const RequireExternalRecoveryAddressInput = Schema.Struct({
  address: EmailAddress,
  excludeRecoveryIdentityId: Schema.optional(ExternalRecoveryIdentityId),
});
export type RequireExternalRecoveryAddressInput = Schema.Schema.Type<
  typeof RequireExternalRecoveryAddressInput
>;
