import { describe, expect, it } from "vitest";

import {
  OrganizationOperation,
  OrganizationSessionRequirementsMatrix,
} from "#/apps/backend-worker/OrganizationSessionRequirements";
import { evaluateSessionRequirements } from "#/modules/account-security/domain/SessionRequirementsPolicy";

describe("organization session requirements", () => {
  it("covers the exact lifecycle endpoint inventory", () => {
    expect(
      Object.keys(OrganizationSessionRequirementsMatrix.operations)
    ).toStrictEqual(Object.values(OrganizationOperation));
    for (const operation of Object.values(OrganizationOperation)) {
      expect(
        evaluateSessionRequirements(
          OrganizationSessionRequirementsMatrix,
          operation
        )
      ).toStrictEqual({ type: "allowed" });
      expect(
        evaluateSessionRequirements(
          OrganizationSessionRequirementsMatrix,
          operation,
          { requirements: ["recovery_remediation"] }
        )
      ).toMatchObject({ type: "denied" });
    }
    expect(
      evaluateSessionRequirements(
        OrganizationSessionRequirementsMatrix,
        "deleteOrganization"
      )
    ).toStrictEqual({ reason: "operation-not-declared", type: "denied" });
  });
});
