import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { OrganizationAdministrationReceiptSchema } from "#/modules/organization/application/OrganizationAdministration";

const receipt = {
  actorUserId: "user-a",
  auditEventId:
    "admin-audit-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  committedAt: 2000,
  expectedVersion: 1,
  matrixId: "organization-operations",
  matrixVersion: 1,
  operationId: "00000000-0000-4000-8000-000000000001",
  operationKind: "suspend",
  organizationId: "organization-a",
  result: {
    createdAt: 1000,
    id: "organization-a",
    status: "suspended",
    updatedAt: 2000,
    version: 2,
  },
  schemaVersion: 1,
  stepUpPolicyId: "control-plane-sensitive",
  stepUpPolicyVersion: 1,
} as const;

const decodes = (input: unknown) =>
  Exit.isSuccess(
    Schema.decodeUnknownExit(OrganizationAdministrationReceiptSchema)(input)
  );

describe("OrganizationAdministration receipt", () => {
  it("binds lifecycle intent, result, audit, and versioned policies", () => {
    expect(decodes(receipt)).toBeTruthy();
    expect(
      decodes({
        ...receipt,
        operationKind: "resume",
        result: { ...receipt.result, status: "active" },
      })
    ).toBeTruthy();
  });

  it.each([
    { result: { ...receipt.result, id: "organization-b" } },
    { result: { ...receipt.result, status: "active" } },
    { result: { ...receipt.result, version: 3 } },
    { result: { ...receipt.result, updatedAt: 1999 } },
    { matrixVersion: 2 },
    { stepUpPolicyId: "other" },
    { operationKind: "delete" },
  ])("rejects inconsistent or unknown receipt fields: %#", (override) => {
    expect(decodes({ ...receipt, ...override })).toBeFalsy();
  });
});
