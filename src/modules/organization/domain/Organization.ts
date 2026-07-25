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

/** Reserved migration identity for the first deployment organization. */
export const LEGACY_DEFAULT_ORGANIZATION_ID: OrganizationId =
  Schema.decodeUnknownSync(OrganizationId)("legacy_default_v1");

export const OrganizationStatus = Schema.Literals(["active", "suspended"]);
export type OrganizationStatus = Schema.Schema.Type<typeof OrganizationStatus>;

export const OrganizationOperation = Schema.Literals([
  "organization.read",
  "organization.audit.read",
  "organization.lifecycle.read-operation",
  "organization.lifecycle.suspend",
  "organization.lifecycle.resume",
  "organization.settings.manage",
  "organization.members.manage",
  "organization.domains.manage",
  "organization.addresses.manage",
  "organization.mailboxes.manage",
  "organization.ownership.transfer",
]);
export type OrganizationOperation = Schema.Schema.Type<
  typeof OrganizationOperation
>;

export const ORGANIZATION_OPERATION_MATRIX_ID = "organization-operations";
export const ORGANIZATION_OPERATION_MATRIX_VERSION = 1;

const allowedInBothStatuses = ["active", "suspended"] as const;
const allowedWhileActive = ["active"] as const;

/** Closed first-release status policy. Unknown operations fail closed. */
export const OrganizationOperationMatrix = {
  matrixId: ORGANIZATION_OPERATION_MATRIX_ID,
  operations: {
    "organization.read": allowedInBothStatuses,
    "organization.audit.read": allowedInBothStatuses,
    "organization.lifecycle.read-operation": allowedInBothStatuses,
    "organization.lifecycle.suspend": allowedWhileActive,
    "organization.lifecycle.resume": ["suspended"],
    "organization.settings.manage": allowedWhileActive,
    "organization.members.manage": allowedWhileActive,
    "organization.domains.manage": allowedWhileActive,
    "organization.addresses.manage": allowedWhileActive,
    "organization.mailboxes.manage": allowedWhileActive,
    "organization.ownership.transfer": allowedWhileActive,
  },
  policyVersion: ORGANIZATION_OPERATION_MATRIX_VERSION,
} as const satisfies {
  readonly matrixId: typeof ORGANIZATION_OPERATION_MATRIX_ID;
  readonly operations: Readonly<
    Record<OrganizationOperation, readonly OrganizationStatus[]>
  >;
  readonly policyVersion: typeof ORGANIZATION_OPERATION_MATRIX_VERSION;
};

export const isOrganizationOperationAllowed = (
  status: OrganizationStatus,
  operation: string
): boolean => {
  if (!Object.hasOwn(OrganizationOperationMatrix.operations, operation)) {
    return false;
  }
  return (
    (
      OrganizationOperationMatrix.operations as Readonly<
        Record<string, readonly OrganizationStatus[]>
      >
    )[operation]?.includes(status) === true
  );
};

export const organizationLifecycleTransition = (
  operation: "organization.lifecycle.resume" | "organization.lifecycle.suspend"
) => {
  const transition =
    operation === "organization.lifecycle.suspend"
      ? ({ sourceStatus: "active", targetStatus: "suspended" } as const)
      : ({ sourceStatus: "suspended", targetStatus: "active" } as const);
  return isOrganizationOperationAllowed(transition.sourceStatus, operation) &&
    !isOrganizationOperationAllowed(transition.targetStatus, operation)
    ? transition
    : undefined;
};

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
