import { UserIdSchema } from "@effect-auth/core/Identifiers";
import * as Schema from "effect/Schema";

import { OrganizationId } from "#/modules/organization/domain/Organization";
import { ResourceId } from "#/shared/Resource";
import { UnixMillis, Version } from "#/shared/Temporal";

export const OrganizationMemberId = ResourceId.pipe(
  Schema.check(
    Schema.makeFilter((id) =>
      /[^A-Za-z0-9_-]/u.test(id)
        ? "OrganizationMemberId may contain only ASCII letters, digits, underscores, and hyphens"
        : undefined
    )
  ),
  Schema.brand("cloudflare-inbox/OrganizationMemberId")
);
export type OrganizationMemberId = Schema.Schema.Type<
  typeof OrganizationMemberId
>;

export const OrganizationMemberStatus = Schema.Literals([
  "active",
  "suspended",
  "revoked",
]);
export type OrganizationMemberStatus = Schema.Schema.Type<
  typeof OrganizationMemberStatus
>;

const OrganizationMemberUserId = UserIdSchema.pipe(
  Schema.check(
    Schema.makeFilter((userId) =>
      userId.length === 0
        ? "organization membership user ID cannot be empty"
        : undefined
    )
  )
);

export class OrganizationMember extends Schema.Class<OrganizationMember>(
  "cloudflare-inbox/OrganizationMember"
)({
  createdAt: UnixMillis,
  id: OrganizationMemberId,
  organizationId: OrganizationId,
  revokedAt: Schema.NullOr(UnixMillis),
  status: OrganizationMemberStatus,
  suspendedAt: Schema.NullOr(UnixMillis),
  updatedAt: UnixMillis,
  userId: OrganizationMemberUserId,
  version: Version,
}) {}

export const OrganizationMemberSchema = OrganizationMember.check(
  Schema.makeFilter((member) => {
    if (member.updatedAt < member.createdAt) {
      return "organization membership cannot be updated before creation";
    }
    if (member.status === "active") {
      return member.suspendedAt === null && member.revokedAt === null
        ? undefined
        : "active organization membership cannot have lifecycle timestamps";
    }
    if (member.status === "suspended") {
      return member.suspendedAt === member.updatedAt &&
        member.revokedAt === null
        ? undefined
        : "suspended organization membership must record its update time";
    }
    return member.revokedAt === member.updatedAt &&
      (member.suspendedAt === null ||
        (member.suspendedAt >= member.createdAt &&
          member.suspendedAt <= member.revokedAt))
      ? undefined
      : "revoked organization membership must preserve its lifecycle history";
  })
);
