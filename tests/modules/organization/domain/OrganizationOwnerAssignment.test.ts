import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { OrganizationOwnerAssignmentReceiptSchema } from "#/modules/organization/domain/OrganizationOwnerAssignment";

const operationId = "00000000-0000-4000-8000-000000000010";
const auditEventId = `admin-audit-sha256:${"a".repeat(64)}`;
const receipt = {
  assignedAt: 1000,
  mailboxId: "primary",
  membershipId: "legacy_default_v1_owner_v1",
  organizationId: "legacy_default_v1",
  schemaVersion: 1,
  source: "legacy-cutover",
  sourceAuditEventId: null,
  sourceBootstrapOperationId: null,
  userId: "user-a",
} as const;

describe("organization owner assignment receipt", () => {
  it.each([
    receipt,
    { ...receipt, sourceAuditEventId: auditEventId },
    {
      ...receipt,
      sourceAuditEventId: auditEventId,
      sourceBootstrapOperationId: operationId,
    },
    {
      ...receipt,
      source: "fresh-bootstrap",
      sourceAuditEventId: auditEventId,
      sourceBootstrapOperationId: operationId,
    },
  ])("accepts an exact supported provenance mode", (input) => {
    expect(() =>
      Schema.decodeUnknownSync(OrganizationOwnerAssignmentReceiptSchema)(input)
    ).not.toThrow();
  });

  it.each([
    {
      ...receipt,
      sourceBootstrapOperationId: operationId,
    },
    {
      ...receipt,
      source: "fresh-bootstrap",
    },
    {
      ...receipt,
      source: "fresh-bootstrap",
      sourceAuditEventId: auditEventId,
    },
    {
      ...receipt,
      source: "fresh-bootstrap",
      sourceBootstrapOperationId: operationId,
    },
  ])("rejects incomplete provenance", (input) => {
    expect(() =>
      Schema.decodeUnknownSync(OrganizationOwnerAssignmentReceiptSchema)(input)
    ).toThrow(/provenance/u);
  });
});
