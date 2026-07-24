import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  OrganizationMemberId,
  OrganizationMemberSchema,
  OrganizationMemberStatus,
} from "#/modules/organization/domain/OrganizationMember";

const decodeSucceeds = <S extends Schema.ConstraintDecoder<unknown, never>>(
  schema: S,
  input: unknown
) => Exit.isSuccess(Schema.decodeUnknownExit(schema)(input));

const activeMember = {
  createdAt: 1000,
  id: "member-a",
  organizationId: "organization-a",
  revokedAt: null,
  status: "active",
  suspendedAt: null,
  updatedAt: 1000,
  userId: "user-a",
  version: 1,
} as const;

describe("organization member domain", () => {
  it("brands stable identifiers with the exact ASCII grammar", () => {
    for (const id of ["A", "a", "Az09_-", "x".repeat(128)]) {
      expect(Schema.decodeUnknownSync(OrganizationMemberId)(id)).toBe(id);
    }

    for (const id of [
      "",
      "x".repeat(129),
      " member-a ",
      "member\ta",
      "member\u00A0a",
      "member\na",
      "member\0a",
      "member😀a",
      "membør-a",
      "member.a",
    ]) {
      expect(decodeSucceeds(OrganizationMemberId, id)).toBeFalsy();
    }
  });

  it("closes the status catalog", () => {
    for (const status of ["active", "suspended", "revoked"] as const) {
      expect(Schema.decodeUnknownSync(OrganizationMemberStatus)(status)).toBe(
        status
      );
    }
    expect(decodeSucceeds(OrganizationMemberStatus, "deleted")).toBeFalsy();
  });

  it("decodes each lifecycle shape and preserves suspension history", () => {
    const suspended = {
      ...activeMember,
      status: "suspended",
      suspendedAt: 1100,
      updatedAt: 1100,
      version: 2,
    } as const;
    const revokedFromActive = {
      ...activeMember,
      revokedAt: 1100,
      status: "revoked",
      updatedAt: 1100,
      version: 2,
    } as const;
    const revokedFromSuspended = {
      ...suspended,
      revokedAt: 1200,
      status: "revoked",
      updatedAt: 1200,
      version: 3,
    } as const;

    for (const member of [
      activeMember,
      suspended,
      revokedFromActive,
      revokedFromSuspended,
    ]) {
      expect(
        Schema.decodeUnknownSync(OrganizationMemberSchema)(member)
      ).toMatchObject(member);
    }
  });

  it("rejects inconsistent lifecycle timestamps and unsafe temporal data", () => {
    const invalidMembers = [
      { ...activeMember, suspendedAt: 1000 },
      {
        ...activeMember,
        status: "suspended",
        suspendedAt: 1001,
        updatedAt: 1100,
        version: 2,
      },
      {
        ...activeMember,
        revokedAt: 1100,
        status: "revoked",
        suspendedAt: 999,
        updatedAt: 1100,
        version: 2,
      },
      { ...activeMember, updatedAt: 999 },
      { ...activeMember, createdAt: 1.5, updatedAt: 1.5 },
      { ...activeMember, updatedAt: Number.MAX_SAFE_INTEGER + 1 },
      { ...activeMember, userId: "" },
      { ...activeMember, version: Number.MAX_SAFE_INTEGER + 1 },
    ];

    for (const member of invalidMembers) {
      expect(decodeSucceeds(OrganizationMemberSchema, member)).toBeFalsy();
    }
  });
});
