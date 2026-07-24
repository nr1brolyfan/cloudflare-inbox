import type { ChallengeService } from "@effect-auth/core/Challenge";
import { Challenge } from "@effect-auth/core/Challenge";
import {
  ChallengeId,
  Email,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import type { PasswordResetService } from "@effect-auth/core/Password";
import { PasswordReset } from "@effect-auth/core/Password";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { describe, expect, it } from "vitest";

import { ExistingPasswordResetEffectAuthLayer } from "#/modules/account-security/adapters/effect-auth/ExistingPasswordResetEffectAuth";
import { isRecoverySafeEmailInitiationDenied } from "#/modules/account-security/adapters/effect-auth/RecoverySafeEmailInitiationEffectAuth";
import { PasswordResetEligibility } from "#/modules/account-security/application/PasswordResetEligibility";
import { RecoverySafeIdentityRejected } from "#/modules/account-security/domain/RecoverySafeIdentityError";
import { RecoverySafeIdentityPolicy } from "#/modules/account-security/ports/RecoverySafeIdentityPolicy";

const userId = UserId("user-a");
const verifyInput = {
  challengeId: ChallengeId("challenge-a"),
  password: Redacted.make("new-password"),
  secret: Redacted.make("challenge-secret"),
};
const startInput = {
  identity: {
    kind: "email" as const,
    scope: { type: "global" as const },
    value: "person@example.test",
  },
};

const runPasswordReset = <A, E>(
  eligible: boolean,
  use: (passwordReset: PasswordResetService) => Effect.Effect<A, E>,
  callbacks: {
    readonly onStart?: () => void;
    readonly onVerify?: () => void;
    readonly onPolicy?: () => void;
    readonly policyFailure?: RecoverySafeIdentityRejected;
  } = {}
) => {
  const challenge: ChallengeService = {
    consume: () => Effect.die("consume is not used"),
    inspect: () =>
      Effect.succeed({
        expiresAt: UnixMillis(10_000),
        id: verifyInput.challengeId,
        metadata: { userId },
        subject: "person@example.test",
        type: "reset-password",
      }),
    issue: () => Effect.die("issue is not used"),
    verify: () => Effect.die("verify is not used"),
  };
  const passwordReset: PasswordResetService = {
    start: () =>
      Effect.sync(() => {
        callbacks.onStart?.();
        return {
          email: Email("person@example.test"),
          expiresAt: UnixMillis(10_000),
        };
      }),
    verify: () => Effect.sync(() => callbacks.onVerify?.()),
  };
  const wrappedLive = ExistingPasswordResetEffectAuthLayer.pipe(
    Layer.provide(Layer.succeed(Challenge, challenge)),
    Layer.provide(
      Layer.succeed(
        PasswordResetEligibility,
        PasswordResetEligibility.of({
          hasActivePassword: () => Effect.succeed(eligible),
          hasActivePasswordForUserId: () => Effect.succeed(eligible),
        })
      )
    ),
    Layer.provide(
      Layer.succeed(
        RecoverySafeIdentityPolicy,
        RecoverySafeIdentityPolicy.of({
          requireSafeAddress: () =>
            Effect.sync(() => callbacks.onPolicy?.()).pipe(
              Effect.flatMap(() =>
                callbacks.policyFailure === undefined
                  ? Effect.void
                  : Effect.fail(callbacks.policyFailure)
              )
            ),
        })
      )
    ),
    Layer.provide(Layer.succeed(PasswordReset, passwordReset))
  );

  return Effect.gen(function* () {
    const reset = yield* PasswordReset;
    return yield* use(reset);
  }).pipe(Effect.provide(wrappedLive));
};

describe("existing password reset", () => {
  it("rejects a valid legacy challenge when the user has no password", async () => {
    let verifies = 0;

    const error = await Effect.runPromise(
      runPasswordReset(
        false,
        (passwordReset) => passwordReset.verify(verifyInput),
        {
          onVerify: () => {
            verifies += 1;
          },
        }
      ).pipe(Effect.flip)
    );

    expect(error).toMatchObject({
      _tag: "PasswordResetVerifyError",
      message: "Invalid password reset challenge",
    });
    expect(verifies).toBe(0);
  });

  it("delegates verification while an active password still exists", async () => {
    let verifies = 0;

    await Effect.runPromise(
      runPasswordReset(
        true,
        (passwordReset) => passwordReset.verify(verifyInput),
        {
          onVerify: () => {
            verifies += 1;
          },
        }
      )
    );

    expect(verifies).toBe(1);
  });

  it("suppresses reset start after the standard guard for passwordless users", async () => {
    let policies = 0;
    let starts = 0;

    const result = await Effect.runPromise(
      runPasswordReset(
        false,
        (passwordReset) => passwordReset.start(startInput),
        {
          onStart: () => {
            starts += 1;
          },
          onPolicy: () => {
            policies += 1;
          },
        }
      )
    );

    expect(result.expiresAt).toBe(0);
    expect(policies).toBe(0);
    expect(starts).toBe(0);
  });

  it("delegates reset start for an existing active password", async () => {
    const events: string[] = [];

    const result = await Effect.runPromise(
      runPasswordReset(
        true,
        (passwordReset) => passwordReset.start(startInput),
        {
          onStart: () => {
            events.push("start");
          },
          onPolicy: () => events.push("policy"),
        }
      )
    );

    expect(result.expiresAt).toBe(10_000);
    expect(events).toStrictEqual(["policy", "start"]);
  });

  it("denies reset start by policy without delegating", async () => {
    let starts = 0;
    const error = await Effect.runPromise(
      runPasswordReset(
        true,
        (passwordReset) => passwordReset.start(startInput).pipe(Effect.flip),
        {
          onStart: () => {
            starts += 1;
          },
          policyFailure: new RecoverySafeIdentityRejected({
            reason: "recovery-identity",
          }),
        }
      )
    );

    expect(error.message).toBe("Email initiation denied");
    expect(isRecoverySafeEmailInitiationDenied(error)).toBeTruthy();
    expect(starts).toBe(0);
  });

  it("keeps policy storage failure internal without delegating", async () => {
    let starts = 0;
    const error = await Effect.runPromise(
      runPasswordReset(
        true,
        (passwordReset) => passwordReset.start(startInput).pipe(Effect.flip),
        {
          onStart: () => {
            starts += 1;
          },
          policyFailure: new RecoverySafeIdentityRejected({
            cause: new Error("database unavailable"),
            reason: "storage",
          }),
        }
      )
    );

    expect(error.message).toBe("Failed to evaluate email initiation policy");
    expect(isRecoverySafeEmailInitiationDenied(error)).toBeFalsy();
    expect(starts).toBe(0);
  });
});
