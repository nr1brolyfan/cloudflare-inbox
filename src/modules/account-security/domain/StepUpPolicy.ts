import { UnixMillisSchema } from "@effect-auth/core/Identifiers";
import type { CurrentSessionShape } from "@effect-auth/core/Sessions";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { SensitiveOperationStepUpRequired } from "./StepUpError";

export const AuthenticationEventSchemaVersion = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1)),
  Schema.brand("cloudflare-inbox/AuthenticationEventSchemaVersion")
);
export type AuthenticationEventSchemaVersion = Schema.Schema.Type<
  typeof AuthenticationEventSchemaVersion
>;

export const StepUpPolicyId = Schema.Trimmed.pipe(
  Schema.check(Schema.isLengthBetween(1, 128)),
  Schema.brand("cloudflare-inbox/StepUpPolicyId")
);
export type StepUpPolicyId = Schema.Schema.Type<typeof StepUpPolicyId>;

export const StepUpPolicyVersion = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1)),
  Schema.brand("cloudflare-inbox/StepUpPolicyVersion")
);
export type StepUpPolicyVersion = Schema.Schema.Type<
  typeof StepUpPolicyVersion
>;

export const StepUpMaxAgeMillis = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1)),
  Schema.brand("cloudflare-inbox/StepUpMaxAgeMillis")
);
export type StepUpMaxAgeMillis = Schema.Schema.Type<typeof StepUpMaxAgeMillis>;

export const StepUpVerifiedAt = UnixMillisSchema.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
);

export const SensitiveOperationEvidenceMethod = Schema.Literals([
  "password",
  "totp",
  "verified-passkey",
]);
export type SensitiveOperationEvidenceMethod = Schema.Schema.Type<
  typeof SensitiveOperationEvidenceMethod
>;

export class SensitiveOperationStepUpPolicy extends Schema.Class<SensitiveOperationStepUpPolicy>(
  "cloudflare-inbox/SensitiveOperationStepUpPolicy"
)({
  acceptedEvidence: Schema.Array(SensitiveOperationEvidenceMethod),
  id: StepUpPolicyId,
  maxAgeMs: StepUpMaxAgeMillis,
  version: StepUpPolicyVersion,
}) {}

export const AUTHENTICATION_EVENT_SCHEMA_VERSION = Schema.decodeUnknownSync(
  AuthenticationEventSchemaVersion
)(1);

export const CONTROL_PLANE_STEP_UP_POLICY = Schema.decodeUnknownSync(
  SensitiveOperationStepUpPolicy
)({
  acceptedEvidence: ["password", "totp", "verified-passkey"],
  id: "control-plane-sensitive",
  maxAgeMs: 5 * 60 * 1000,
  version: 1,
});

const isAcceptedEvidence = (
  policy: SensitiveOperationStepUpPolicy,
  event: CurrentSessionShape["authenticationEvents"][number]
) =>
  (event.type === "password" && policy.acceptedEvidence.includes("password")) ||
  (event.type === "totp" && policy.acceptedEvidence.includes("totp")) ||
  (event.type === "passkey" &&
    event.userVerification === "verified" &&
    policy.acceptedEvidence.includes("verified-passkey"));

export const satisfiesSensitiveOperationStepUp = (
  session: CurrentSessionShape,
  now: number
) => {
  if ((session.claims?.requirements?.length ?? 0) > 0) {
    return false;
  }

  const cutoff = now - CONTROL_PLANE_STEP_UP_POLICY.maxAgeMs;
  return session.authenticationEvents.some(
    (event) =>
      isAcceptedEvidence(CONTROL_PLANE_STEP_UP_POLICY, event) &&
      event.verifiedAt >= cutoff &&
      event.verifiedAt <= now
  );
};

export const requireSensitiveOperationStepUp = (
  session: CurrentSessionShape,
  now: number
): Effect.Effect<void, SensitiveOperationStepUpRequired> => {
  if (satisfiesSensitiveOperationStepUp(session, now)) {
    return Effect.void;
  }

  return Effect.fail(
    new SensitiveOperationStepUpRequired({
      policy: CONTROL_PLANE_STEP_UP_POLICY,
    })
  );
};
