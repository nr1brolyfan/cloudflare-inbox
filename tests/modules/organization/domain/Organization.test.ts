import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  LEGACY_DEFAULT_ORGANIZATION_ID,
  OrganizationId,
  OrganizationSchema,
  OrganizationStatus,
} from "#/modules/organization/domain/Organization";

const decodeSucceeds = <S extends Schema.ConstraintDecoder<unknown, never>>(
  schema: S,
  input: unknown
) => Exit.isSuccess(Schema.decodeUnknownExit(schema)(input));

describe("organization domain", () => {
  it("exposes the reserved legacy migration identity as an OrganizationId", () => {
    expect(LEGACY_DEFAULT_ORGANIZATION_ID).toBe("legacy_default_v1");
    expect(
      Schema.decodeUnknownSync(OrganizationId)(LEGACY_DEFAULT_ORGANIZATION_ID)
    ).toBe(LEGACY_DEFAULT_ORGANIZATION_ID);
  });

  it("brands opaque ASCII resource identifiers", () => {
    for (const id of ["A", "a", "Az09_-", "x".repeat(128)]) {
      expect(Schema.decodeUnknownSync(OrganizationId)(id)).toBe(id);
    }

    for (const id of [
      "",
      "x".repeat(129),
      " organization-a ",
      "organization\ta",
      "organization\u00A0a",
      "organization\na",
      "organization\0a",
      "organization😀a",
      "organizatiøn-a",
      "organization.a",
    ]) {
      expect(decodeSucceeds(OrganizationId, id)).toBeFalsy();
    }
  });

  it("closes the lifecycle status catalog", () => {
    expect(Schema.decodeUnknownSync(OrganizationStatus)("active")).toBe(
      "active"
    );
    expect(Schema.decodeUnknownSync(OrganizationStatus)("suspended")).toBe(
      "suspended"
    );
    expect(decodeSucceeds(OrganizationStatus, "deleted")).toBeFalsy();
  });

  it("decodes organizations with monotonic Unix millisecond timestamps", () => {
    const organization = {
      createdAt: 1000,
      id: "organization-a",
      status: "suspended",
      updatedAt: 2000,
      version: 2,
    } as const;

    expect(
      Schema.decodeUnknownSync(OrganizationSchema)(organization)
    ).toMatchObject(organization);
    expect(
      decodeSucceeds(OrganizationSchema, {
        ...organization,
        updatedAt: 999,
      })
    ).toBeFalsy();
    expect(
      decodeSucceeds(OrganizationSchema, { ...organization, version: 0 })
    ).toBeFalsy();
    expect(
      decodeSucceeds(OrganizationSchema, { ...organization, createdAt: 1.5 })
    ).toBeFalsy();
  });
});
