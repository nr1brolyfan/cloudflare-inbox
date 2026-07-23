import {
  CredentialId,
  SessionId,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import type { CurrentSessionShape } from "@effect-auth/core/Sessions";
import { describe, expect, it } from "vitest";

import {
  CONTROL_PLANE_STEP_UP_POLICY,
  satisfiesSensitiveOperationStepUp,
} from "#/modules/account-security/domain/StepUpPolicy";

const now = 1_000_000;
const makeSession = (
  authenticationEvents: CurrentSessionShape["authenticationEvents"],
  requirements: readonly string[] = []
): CurrentSessionShape => ({
  aal: "aal1",
  amr: [],
  authenticationEvents,
  authTime: UnixMillis(now - 1000),
  claims: requirements.length === 0 ? undefined : { requirements },
  expiresAt: UnixMillis(now + 10_000),
  sessionId: SessionId("session-a"),
  userId: UserId("user-a"),
});

const credentialId = CredentialId("credential-a");

describe("sensitive operation step-up policy", () => {
  it("has a stable policy identity and version", () => {
    expect({
      id: CONTROL_PLANE_STEP_UP_POLICY.id,
      version: CONTROL_PLANE_STEP_UP_POLICY.version,
    }).toStrictEqual({
      id: "control-plane-sensitive",
      version: 1,
    });
  });

  it.each([
    [
      "password",
      {
        credentialId,
        type: "password",
        verifiedAt: UnixMillis(now),
        version: 1,
      },
    ],
    [
      "TOTP",
      {
        acceptedCounter: 1,
        factorId: credentialId,
        type: "totp",
        verifiedAt: UnixMillis(now),
        version: 1,
      },
    ],
    [
      "verified passkey",
      {
        credentialId,
        type: "passkey",
        userVerification: "verified",
        verifiedAt: UnixMillis(now),
        version: 1,
      },
    ],
  ] as const)("accepts recent %s evidence", (_, event) => {
    expect(
      satisfiesSensitiveOperationStepUp(makeSession([event]), now)
    ).toBeTruthy();
  });

  it("accepts evidence exactly at the freshness boundary", () => {
    expect(
      satisfiesSensitiveOperationStepUp(
        makeSession([
          {
            credentialId,
            type: "password",
            verifiedAt: UnixMillis(now - CONTROL_PLANE_STEP_UP_POLICY.maxAgeMs),
            version: 1,
          },
        ]),
        now
      )
    ).toBeTruthy();
  });

  it.each([
    [
      "stale password",
      {
        credentialId,
        type: "password",
        verifiedAt: UnixMillis(now - CONTROL_PLANE_STEP_UP_POLICY.maxAgeMs - 1),
        version: 1,
      },
    ],
    [
      "future password",
      {
        credentialId,
        type: "password",
        verifiedAt: UnixMillis(now + 1),
        version: 1,
      },
    ],
    [
      "email OTP",
      {
        identityId: "identity-a",
        type: "email_otp",
        verifiedAt: UnixMillis(now),
        version: 1,
      },
    ],
    [
      "magic link",
      {
        identityId: "identity-a",
        type: "magic_link",
        verifiedAt: UnixMillis(now),
        version: 1,
      },
    ],
    [
      "unverified passkey",
      {
        credentialId,
        type: "passkey",
        userVerification: "not-verified",
        verifiedAt: UnixMillis(now),
        version: 1,
      },
    ],
    [
      "recovery code",
      {
        codeId: credentialId,
        type: "recovery_code",
        verifiedAt: UnixMillis(now),
        version: 1,
      },
    ],
  ] as const)("rejects %s evidence", (_, event) => {
    expect(
      satisfiesSensitiveOperationStepUp(makeSession([event]), now)
    ).toBeFalsy();
  });

  it("rejects otherwise fresh evidence when session requirements remain", () => {
    expect(
      satisfiesSensitiveOperationStepUp(
        makeSession(
          [
            {
              credentialId,
              type: "password",
              verifiedAt: UnixMillis(now),
              version: 1,
            },
          ],
          ["email_verification"]
        ),
        now
      )
    ).toBeFalsy();
  });
});
