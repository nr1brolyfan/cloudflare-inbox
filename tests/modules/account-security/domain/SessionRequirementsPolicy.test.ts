import type { SessionClaims } from "@effect-auth/core/Sessions";
import { describe, expect, it } from "vitest";

import { evaluateSessionRequirements } from "#/modules/account-security/domain/SessionRequirementsPolicy";
import type {
  OperationSessionPolicy,
  VersionedSessionRequirementsMatrix,
} from "#/modules/account-security/domain/SessionRequirementsPolicy";

type Operation = "enrollment" | "remediation" | "unrestricted";

const matrix = {
  matrixId: "test-session-requirements",
  operations: {
    enrollment: {
      capability: "recovery-codes",
      mode: "recovery-enrollment-only",
    },
    remediation: {
      capability: "second-passkey",
      mode: "recovery-remediation-only",
    },
    unrestricted: { mode: "unrestricted-only" },
  },
  policyVersion: 1,
} as const satisfies VersionedSessionRequirementsMatrix<
  Operation,
  "test-session-requirements",
  1
>;

const decision = (operation: string, claims?: SessionClaims) =>
  evaluateSessionRequirements(matrix, operation, claims);

const malformed = (claims: unknown) => claims as SessionClaims;

describe("session requirements policy", () => {
  it.each([
    ["missing claims", undefined],
    ["empty claims", {}],
    ["empty requirements", { requirements: [] }],
    [
      "unrelated claims",
      { requirements: [], verifiedIdentityKinds: ["email"] },
    ],
  ] as const)("allows unrestricted-only with %s", (_, claims) => {
    expect(decision("unrestricted", claims)).toStrictEqual({ type: "allowed" });
  });

  it.each([
    ["known unfinished requirement", { requirements: ["email_verification"] }],
    [
      "unknown unfinished requirement",
      { requirements: ["future_requirement"] },
    ],
    [
      "recovery enrollment",
      {
        recoveryEnrollment: { allowed: ["recovery-codes"] },
        requirements: ["recovery_enrollment"],
      },
    ],
    [
      "recovery remediation",
      {
        recoveryRemediation: { allowed: ["second-passkey"] },
        requirements: ["recovery_remediation"],
      },
    ],
    [
      "dangling enrollment container",
      { recoveryEnrollment: { allowed: ["recovery-codes"] }, requirements: [] },
    ],
    [
      "dangling remediation container",
      {
        recoveryRemediation: { allowed: ["second-passkey"] },
        requirements: [],
      },
    ],
  ] as const)("denies unrestricted-only with %s", (_, claims) => {
    expect(decision("unrestricted", claims)).toMatchObject({
      type: "denied",
    });
  });

  it.each([
    ["requirements object", { requirements: {} }],
    ["requirements string", { requirements: "email_verification" }],
    ["requirements mixed array", { requirements: ["email_verification", 1] }],
    ["enrollment null", { recoveryEnrollment: null, requirements: [] }],
    [
      "enrollment missing allowed",
      { recoveryEnrollment: {}, requirements: [] },
    ],
    [
      "enrollment allowed object",
      { recoveryEnrollment: { allowed: {} }, requirements: [] },
    ],
    ["remediation null", { recoveryRemediation: null, requirements: [] }],
    [
      "remediation allowed string",
      { recoveryRemediation: { allowed: "second-passkey" }, requirements: [] },
    ],
  ] as const)("fails closed for malformed %s", (_, claims) => {
    expect(decision("unrestricted", malformed(claims))).toMatchObject({
      type: "denied",
    });
  });

  it.each([
    [
      "recovery enrollment",
      "enrollment",
      {
        recoveryEnrollment: { allowed: ["recovery-codes"] },
        requirements: ["recovery_enrollment"],
      },
    ],
    [
      "recovery remediation",
      "remediation",
      {
        recoveryRemediation: { allowed: ["second-passkey"] },
        requirements: ["recovery_remediation"],
      },
    ],
  ] as const)(
    "allows an exact singleton %s exception",
    (_, operation, claims) => {
      expect(decision(operation, claims)).toStrictEqual({ type: "allowed" });
    }
  );

  it.each([
    ["unrestricted claims", undefined],
    [
      "missing requirement",
      { recoveryRemediation: { allowed: ["second-passkey"] } },
    ],
    [
      "dangling capability",
      {
        recoveryRemediation: { allowed: ["second-passkey"] },
        requirements: [],
      },
    ],
    [
      "empty capabilities",
      {
        recoveryRemediation: { allowed: [] },
        requirements: ["recovery_remediation"],
      },
    ],
    [
      "unrelated capability",
      {
        recoveryRemediation: { allowed: ["verified-email"] },
        requirements: ["recovery_remediation"],
      },
    ],
    [
      "overbroad capabilities",
      {
        recoveryRemediation: {
          allowed: ["second-passkey", "verified-email"],
        },
        requirements: ["recovery_remediation"],
      },
    ],
    [
      "duplicate capabilities",
      {
        recoveryRemediation: {
          allowed: ["second-passkey", "second-passkey"],
        },
        requirements: ["recovery_remediation"],
      },
    ],
    [
      "additional requirement",
      {
        recoveryRemediation: { allowed: ["second-passkey"] },
        requirements: ["recovery_remediation", "email_verification"],
      },
    ],
    [
      "duplicate requirement",
      {
        recoveryRemediation: { allowed: ["second-passkey"] },
        requirements: ["recovery_remediation", "recovery_remediation"],
      },
    ],
    [
      "other recovery container",
      {
        recoveryEnrollment: { allowed: ["recovery-codes"] },
        recoveryRemediation: { allowed: ["second-passkey"] },
        requirements: ["recovery_remediation"],
      },
    ],
    [
      "malformed capabilities",
      {
        recoveryRemediation: { allowed: "second-passkey" },
        requirements: ["recovery_remediation"],
      },
    ],
  ] as const)("denies a remediation exception with %s", (_, claims) => {
    expect(decision("remediation", malformed(claims))).toMatchObject({
      type: "denied",
    });
  });

  it.each([
    ["wrong requirement", { requirements: ["recovery_remediation"] }],
    [
      "empty capabilities",
      {
        recoveryEnrollment: { allowed: [] },
        requirements: ["recovery_enrollment"],
      },
    ],
    [
      "unrelated capability",
      {
        recoveryEnrollment: { allowed: ["second-passkey"] },
        requirements: ["recovery_enrollment"],
      },
    ],
    [
      "overbroad capabilities",
      {
        recoveryEnrollment: {
          allowed: ["recovery-codes", "verified-email"],
        },
        requirements: ["recovery_enrollment"],
      },
    ],
    [
      "other recovery container",
      {
        recoveryEnrollment: { allowed: ["recovery-codes"] },
        recoveryRemediation: { allowed: ["second-passkey"] },
        requirements: ["recovery_enrollment"],
      },
    ],
  ] as const)("denies an enrollment exception with %s", (_, claims) => {
    expect(decision("enrollment", claims)).toMatchObject({ type: "denied" });
  });

  it("denies an unknown operation before evaluating claims", () => {
    expect(decision("not-declared")).toStrictEqual({
      reason: "operation-not-declared",
      type: "denied",
    });
  });

  it("denies an unknown runtime policy mode", () => {
    const invalidMatrix = {
      ...matrix,
      operations: {
        ...matrix.operations,
        unrestricted: {
          mode: "future-mode",
        } as unknown as OperationSessionPolicy,
      },
    };
    expect(
      evaluateSessionRequirements(invalidMatrix, "unrestricted")
    ).toMatchObject({ type: "denied" });
  });
});
