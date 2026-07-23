import type { RecoveryCapabilityKind } from "@effect-auth/core/RecoveryPolicy";
import type { SessionClaims } from "@effect-auth/core/Sessions";

export type OperationSessionPolicy =
  | { readonly mode: "unrestricted-only" }
  | {
      readonly capability: RecoveryCapabilityKind;
      readonly mode: "recovery-enrollment-only";
    }
  | {
      readonly capability: RecoveryCapabilityKind;
      readonly mode: "recovery-remediation-only";
    };

export interface VersionedSessionRequirementsMatrix<
  Operation extends string,
  MatrixId extends string,
  Version extends number,
> {
  readonly matrixId: MatrixId;
  readonly operations: Readonly<Record<Operation, OperationSessionPolicy>>;
  readonly policyVersion: Version;
}

export type SessionRequirementsDecision =
  | { readonly type: "allowed" }
  | {
      readonly reason:
        | "exact-capability-required"
        | "operation-not-declared"
        | "unrestricted-session-required";
      readonly type: "denied";
    };

const denied = (
  reason: Extract<SessionRequirementsDecision, { type: "denied" }>["reason"]
): SessionRequirementsDecision => ({ reason, type: "denied" });

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringArray = (value: unknown): readonly string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;

interface DecodedClaims {
  readonly recoveryEnrollment?: readonly string[];
  readonly recoveryEnrollmentPresent: boolean;
  readonly recoveryRemediation?: readonly string[];
  readonly recoveryRemediationPresent: boolean;
  readonly requirements: readonly string[];
}

const decodeCapabilityContainer = (
  claims: Readonly<Record<string, unknown>>,
  key: "recoveryEnrollment" | "recoveryRemediation"
) => {
  const container = claims[key];
  if (container === undefined) {
    return { present: false } as const;
  }
  if (!isRecord(container)) {
    return { present: true } as const;
  }
  const allowed = stringArray(container.allowed);
  return allowed === undefined
    ? ({ present: true } as const)
    : ({ allowed, present: true } as const);
};

const decodeClaims = (
  claims: SessionClaims | undefined
): DecodedClaims | undefined => {
  if (claims === undefined) {
    return {
      recoveryEnrollmentPresent: false,
      recoveryRemediationPresent: false,
      requirements: [],
    };
  }
  if (!isRecord(claims)) {
    return undefined;
  }

  const requirements =
    claims.requirements === undefined ? [] : stringArray(claims.requirements);
  if (requirements === undefined) {
    return undefined;
  }

  const recoveryEnrollment = decodeCapabilityContainer(
    claims,
    "recoveryEnrollment"
  );
  const recoveryRemediation = decodeCapabilityContainer(
    claims,
    "recoveryRemediation"
  );

  return {
    ...(recoveryEnrollment.allowed === undefined
      ? {}
      : { recoveryEnrollment: recoveryEnrollment.allowed }),
    recoveryEnrollmentPresent: recoveryEnrollment.present,
    ...(recoveryRemediation.allowed === undefined
      ? {}
      : { recoveryRemediation: recoveryRemediation.allowed }),
    recoveryRemediationPresent: recoveryRemediation.present,
    requirements,
  };
};

const exactCapabilityAllowed = (
  claims: DecodedClaims,
  input: {
    readonly allowed: readonly string[] | undefined;
    readonly capability: RecoveryCapabilityKind;
    readonly otherContainerPresent: boolean;
    readonly requirement: "recovery_enrollment" | "recovery_remediation";
  }
) =>
  claims.requirements.length === 1 &&
  claims.requirements[0] === input.requirement &&
  input.allowed?.length === 1 &&
  input.allowed[0] === input.capability &&
  !input.otherContainerPresent;

export const evaluateSessionRequirements = <
  Operation extends string,
  MatrixId extends string,
  Version extends number,
>(
  matrix: VersionedSessionRequirementsMatrix<Operation, MatrixId, Version>,
  operation: string,
  claims?: SessionClaims
): SessionRequirementsDecision => {
  if (!Object.hasOwn(matrix.operations, operation)) {
    return denied("operation-not-declared");
  }

  const policy = (matrix.operations as Readonly<Record<string, unknown>>)[
    operation
  ];
  const decoded = decodeClaims(claims);
  if (decoded === undefined || !isRecord(policy)) {
    return denied("unrestricted-session-required");
  }

  switch (policy.mode) {
    case "unrestricted-only": {
      return decoded.requirements.length === 0 &&
        !decoded.recoveryEnrollmentPresent &&
        !decoded.recoveryRemediationPresent
        ? { type: "allowed" }
        : denied("unrestricted-session-required");
    }
    case "recovery-enrollment-only": {
      return typeof policy.capability === "string" &&
        exactCapabilityAllowed(decoded, {
          allowed: decoded.recoveryEnrollment,
          capability: policy.capability,
          otherContainerPresent: decoded.recoveryRemediationPresent,
          requirement: "recovery_enrollment",
        })
        ? { type: "allowed" }
        : denied("exact-capability-required");
    }
    case "recovery-remediation-only": {
      return typeof policy.capability === "string" &&
        exactCapabilityAllowed(decoded, {
          allowed: decoded.recoveryRemediation,
          capability: policy.capability,
          otherContainerPresent: decoded.recoveryEnrollmentPresent,
          requirement: "recovery_remediation",
        })
        ? { type: "allowed" }
        : denied("exact-capability-required");
    }
    default: {
      return denied("exact-capability-required");
    }
  }
};
