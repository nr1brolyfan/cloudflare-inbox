import { UserIdSchema } from "@effect-auth/core/Identifiers";
import * as Schema from "effect/Schema";

import { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import { OrganizationId } from "#/modules/organization/domain/Organization";
import { UnixMillis, Version } from "#/shared/Temporal";

const settingsJsonFilter = Schema.makeFilter<string>((value) => {
  if (value.length > 65_536) {
    let codePoints = 0;
    for (const _codePoint of value) {
      codePoints += 1;
      if (codePoints > 65_536) {
        return "settingsJson cannot exceed 65536 Unicode code points";
      }
    }
  }

  try {
    const decoded: unknown = JSON.parse(value);
    return decoded !== null &&
      typeof decoded === "object" &&
      !Array.isArray(decoded)
      ? undefined
      : "settingsJson must encode a JSON object";
  } catch {
    return "settingsJson must encode a JSON object";
  }
});

export const OrganizationPreferenceSettingsJson = Schema.String.pipe(
  Schema.check(settingsJsonFilter),
  Schema.brand("cloudflare-inbox/OrganizationPreferenceSettingsJson")
);
export type OrganizationPreferenceSettingsJson = Schema.Schema.Type<
  typeof OrganizationPreferenceSettingsJson
>;

export class UserOrganizationPreference extends Schema.Class<UserOrganizationPreference>(
  "cloudflare-inbox/UserOrganizationPreference"
)({
  createdAt: UnixMillis,
  defaultMailboxId: Schema.NullOr(MailboxId),
  organizationId: OrganizationId,
  settingsJson: OrganizationPreferenceSettingsJson,
  updatedAt: UnixMillis,
  userId: UserIdSchema,
  version: Version,
}) {}

export const UserOrganizationPreferenceSchema =
  UserOrganizationPreference.check(
    Schema.makeFilter((preference) =>
      preference.updatedAt >= preference.createdAt
        ? undefined
        : "updatedAt cannot be earlier than createdAt"
    )
  );
