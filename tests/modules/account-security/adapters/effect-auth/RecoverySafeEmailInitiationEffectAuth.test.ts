import type { EmailOtpLoginService } from "@effect-auth/core/EmailOtp";
import { EmailOtpLogin } from "@effect-auth/core/EmailOtp";
import type { EmailVerificationFlowService } from "@effect-auth/core/EmailVerification";
import { EmailVerificationFlow } from "@effect-auth/core/EmailVerification";
import {
  ChallengeId,
  Email,
  IdentityId,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import type { MagicLinkLoginService } from "@effect-auth/core/MagicLink";
import { MagicLinkLogin } from "@effect-auth/core/MagicLink";
import type { IdentityStoreService } from "@effect-auth/core/Storage";
import { IdentityStore, StorageError } from "@effect-auth/core/Storage";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { describe, expect, it } from "vitest";

import {
  isRecoverySafeEmailInitiationDenied,
  RecoverySafeEmailInitiationEffectAuthLayer,
} from "#/modules/account-security/adapters/effect-auth/RecoverySafeEmailInitiationEffectAuth";
import { RecoverySafeIdentityRejected } from "#/modules/account-security/domain/RecoverySafeIdentityError";
import { RecoverySafeIdentityPolicy } from "#/modules/account-security/ports/RecoverySafeIdentityPolicy";

const identityId = IdentityId("identity-a");
const userId = UserId("user-a");
const identityInput = {
  kind: "email" as const,
  scope: { type: "global" as const },
  value: "Person@External.test",
};
const storedIdentity = {
  id: identityId,
  userId,
  scope: { type: "global" as const },
  kind: "email" as const,
  value: "Person@External.test",
  normalizedValue: "Person@external.test",
  isPrimaryLogin: true,
  createdAt: UnixMillis(1000),
  updatedAt: UnixMillis(1000),
};

interface TestCallbacks {
  readonly findIdentity?: IdentityStoreService["findById"];
  readonly onEmailOtpStart?: () => void;
  readonly onMagicLinkStart?: () => void;
  readonly onPolicy?: (address: string) => void;
  readonly onVerificationStart?: (metadata: unknown) => void;
  readonly policyFailure?: RecoverySafeIdentityRejected;
}

const testLayer = (callbacks: TestCallbacks = {}) => {
  const emailOtp: EmailOtpLoginService = {
    start: () =>
      Effect.sync(() => {
        callbacks.onEmailOtpStart?.();
        return {
          challengeId: ChallengeId("otp-a"),
          email: Email("Person@external.test"),
          expiresAt: UnixMillis(2000),
        };
      }),
    verify: () => Effect.die("email OTP verify is not used"),
  };
  const magicLink: MagicLinkLoginService = {
    start: () =>
      Effect.sync(() => {
        callbacks.onMagicLinkStart?.();
        return {
          challengeId: ChallengeId("magic-a"),
          email: Email("Person@external.test"),
          expiresAt: UnixMillis(2000),
        };
      }),
    verify: () => Effect.die("magic-link verify is not used"),
  };
  const verification: EmailVerificationFlowService = {
    start: (input) =>
      Effect.sync(() => {
        callbacks.onVerificationStart?.(input.metadata);
        return {
          challengeId: ChallengeId("verification-a"),
          email: Email("Person@external.test"),
          expiresAt: UnixMillis(2000),
          identityId,
          userId,
        };
      }),
  };

  return RecoverySafeEmailInitiationEffectAuthLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(EmailOtpLogin, emailOtp),
        Layer.succeed(MagicLinkLogin, magicLink),
        Layer.succeed(EmailVerificationFlow, verification),
        Layer.mock(IdentityStore, {
          findById:
            callbacks.findIdentity ??
            (() => Effect.succeed(Option.some(storedIdentity))),
        }),
        Layer.succeed(
          RecoverySafeIdentityPolicy,
          RecoverySafeIdentityPolicy.of({
            requireSafeAddress: ({ address }) =>
              Effect.sync(() => callbacks.onPolicy?.(address)).pipe(
                Effect.flatMap(() =>
                  callbacks.policyFailure === undefined
                    ? Effect.void
                    : Effect.fail(callbacks.policyFailure)
                )
              ),
          })
        )
      )
    )
  );
};

const runServices = <A, E>(
  callbacks: TestCallbacks,
  use: (services: {
    readonly emailOtp: EmailOtpLoginService;
    readonly magicLink: MagicLinkLoginService;
    readonly verification: EmailVerificationFlowService;
  }) => Effect.Effect<A, E>
) =>
  Effect.gen(function* () {
    return yield* use({
      emailOtp: yield* EmailOtpLogin,
      magicLink: yield* MagicLinkLogin,
      verification: yield* EmailVerificationFlow,
    });
  }).pipe(Effect.provide(testLayer(callbacks)));

describe("recovery-safe effect-auth email initiation", () => {
  it("checks policy before each raw start and delegates eligible starts once", async () => {
    const events: string[] = [];
    const metadata = { email: "attacker@managed.test" };

    await Effect.runPromise(
      runServices(
        {
          onEmailOtpStart: () => events.push("otp:start"),
          onMagicLinkStart: () => events.push("magic:start"),
          onPolicy: (address) => events.push(`policy:${address}`),
          onVerificationStart: (received) => {
            expect(received).toBe(metadata);
            events.push("verification:start");
          },
        },
        ({ emailOtp, magicLink, verification }) =>
          Effect.gen(function* () {
            yield* emailOtp.start({ identity: identityInput });
            yield* magicLink.start({ identity: identityInput });
            yield* verification.start({ identityId, metadata });
          })
      )
    );

    expect(events).toStrictEqual([
      "policy:Person@External.test",
      "otp:start",
      "policy:Person@External.test",
      "magic:start",
      "policy:Person@external.test",
      "verification:start",
    ]);
  });

  it.each(["managed-domain", "mailbox-address", "recovery-identity"] as const)(
    "maps %s policy denial uniformly and never delegates",
    async (reason) => {
      let starts = 0;
      const errors = await Effect.runPromise(
        runServices(
          {
            onEmailOtpStart: () => {
              starts += 1;
            },
            onMagicLinkStart: () => {
              starts += 1;
            },
            onVerificationStart: () => {
              starts += 1;
            },
            policyFailure: new RecoverySafeIdentityRejected({ reason }),
          },
          ({ emailOtp, magicLink, verification }) =>
            Effect.all([
              emailOtp.start({ identity: identityInput }).pipe(Effect.flip),
              magicLink.start({ identity: identityInput }).pipe(Effect.flip),
              verification.start({ identityId }).pipe(Effect.flip),
            ])
        )
      );

      expect(starts).toBe(0);
      for (const error of errors) {
        expect(error.message).toBe("Email initiation denied");
        expect(isRecoverySafeEmailInitiationDenied(error)).toBeTruthy();
      }
    }
  );

  it("keeps policy storage failure internal and never delegates", async () => {
    let starts = 0;
    const errors = await Effect.runPromise(
      runServices(
        {
          onEmailOtpStart: () => {
            starts += 1;
          },
          onMagicLinkStart: () => {
            starts += 1;
          },
          onVerificationStart: () => {
            starts += 1;
          },
          policyFailure: new RecoverySafeIdentityRejected({
            cause: new Error("database unavailable"),
            reason: "storage",
          }),
        },
        ({ emailOtp, magicLink, verification }) =>
          Effect.all([
            emailOtp.start({ identity: identityInput }).pipe(Effect.flip),
            magicLink.start({ identity: identityInput }).pipe(Effect.flip),
            verification.start({ identityId }).pipe(Effect.flip),
          ])
      )
    );

    expect(starts).toBe(0);
    for (const error of errors) {
      expect(error.message).toBe("Failed to evaluate email initiation policy");
      expect(isRecoverySafeEmailInitiationDenied(error)).toBeFalsy();
    }
  });

  it.each([
    ["missing", Option.none()],
    [
      "revoked",
      Option.some({ ...storedIdentity, revokedAt: UnixMillis(1500) }),
    ],
    ["non-email", Option.some({ ...storedIdentity, kind: "username" })],
  ] as const)(
    "denies a %s verification identity before policy",
    async (_, row) => {
      let policies = 0;
      let starts = 0;
      const error = await Effect.runPromise(
        runServices(
          {
            findIdentity: () => Effect.succeed(row),
            onPolicy: () => {
              policies += 1;
            },
            onVerificationStart: () => {
              starts += 1;
            },
          },
          ({ verification }) =>
            verification.start({ identityId }).pipe(Effect.flip)
        )
      );

      expect(isRecoverySafeEmailInitiationDenied(error)).toBeTruthy();
      expect(policies).toBe(0);
      expect(starts).toBe(0);
    }
  );

  it("propagates verification identity lookup failure as internal", async () => {
    let starts = 0;
    const error = await Effect.runPromise(
      runServices(
        {
          findIdentity: () =>
            Effect.fail(
              new StorageError({
                entity: "identity",
                operation: "find",
                message: "lookup failed",
              })
            ),
          onVerificationStart: () => {
            starts += 1;
          },
        },
        ({ verification }) =>
          verification.start({ identityId }).pipe(Effect.flip)
      )
    );

    expect(error.message).toBe("Failed to resolve email verification identity");
    expect(isRecoverySafeEmailInitiationDenied(error)).toBeFalsy();
    expect(starts).toBe(0);
  });
});
