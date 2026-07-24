import * as Schema from "effect/Schema";

import { ResourceId } from "#/shared/Resource";
import { UnixMillis, Version } from "#/shared/Temporal";

export const OrganizationId = ResourceId.pipe(
  Schema.check(
    Schema.makeFilter((id) =>
      /[^A-Za-z0-9_-]/u.test(id)
        ? "OrganizationId may contain only ASCII letters, digits, underscores, and hyphens"
        : undefined
    )
  ),
  Schema.brand("cloudflare-inbox/OrganizationId")
);
export type OrganizationId = Schema.Schema.Type<typeof OrganizationId>;

export const OrganizationStatus = Schema.Literals(["active", "suspended"]);
export type OrganizationStatus = Schema.Schema.Type<typeof OrganizationStatus>;

export class Organization extends Schema.Class<Organization>(
  "cloudflare-inbox/Organization"
)({
  createdAt: UnixMillis,
  id: OrganizationId,
  status: OrganizationStatus,
  updatedAt: UnixMillis,
  version: Version,
}) {}

export const OrganizationSchema = Organization.check(
  Schema.makeFilter((organization) =>
    organization.updatedAt >= organization.createdAt
      ? undefined
      : "updatedAt cannot be earlier than createdAt"
  )
);
