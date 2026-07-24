import { UserIdSchema } from "@effect-auth/core/Identifiers";
import * as Schema from "effect/Schema";

import { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import { OrganizationId } from "#/modules/organization/domain/Organization";
import { OrganizationMemberId } from "#/modules/organization/domain/OrganizationMember";
import { AdministrativeOperationId } from "#/shared/Operation";
import { ResourceId } from "#/shared/Resource";
import { UnixMillis } from "#/shared/Temporal";

export const OrganizationOwnerAssignmentSource = Schema.Literals([
  "legacy-cutover",
  "fresh-bootstrap",
]);
export type OrganizationOwnerAssignmentSource = Schema.Schema.Type<
  typeof OrganizationOwnerAssignmentSource
>;

export const AdministrativeAuditEventId = ResourceId.pipe(
  Schema.check(Schema.isPattern(/^admin-audit-sha256:[0-9a-f]{64}$/u)),
  Schema.brand("cloudflare-inbox/AdministrativeAuditEventId")
);
export type AdministrativeAuditEventId = Schema.Schema.Type<
  typeof AdministrativeAuditEventId
>;

/** Immutable authority ledger entry produced only by the ORG-008 protocol. */
export class OrganizationOwnerAssignmentReceipt extends Schema.Class<OrganizationOwnerAssignmentReceipt>(
  "cloudflare-inbox/OrganizationOwnerAssignmentReceipt"
)({
  assignedAt: UnixMillis,
  mailboxId: MailboxId,
  membershipId: OrganizationMemberId,
  organizationId: OrganizationId,
  schemaVersion: Schema.Literal(1),
  source: OrganizationOwnerAssignmentSource,
  sourceAuditEventId: Schema.NullOr(AdministrativeAuditEventId),
  sourceBootstrapOperationId: Schema.NullOr(AdministrativeOperationId),
  userId: UserIdSchema,
}) {}

export const OrganizationOwnerAssignmentReceiptSchema =
  OrganizationOwnerAssignmentReceipt.check(
    Schema.makeFilter((receipt) => {
      if (receipt.source === "fresh-bootstrap") {
        return receipt.sourceBootstrapOperationId !== null &&
          receipt.sourceAuditEventId !== null
          ? undefined
          : "fresh bootstrap provenance requires its operation and audit";
      }
      return receipt.sourceBootstrapOperationId === null ||
        receipt.sourceAuditEventId !== null
        ? undefined
        : "legacy bootstrap operation provenance requires its audit event";
    })
  );
