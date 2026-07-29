import { Challenge } from "@effect-auth/core/Challenge";
import { EmailOtpLogin } from "@effect-auth/core/EmailOtp";
import { EmailVerificationCode } from "@effect-auth/core/EmailVerificationCode";
import {
  IdentityId,
  SessionId,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import { MagicLinkLogin } from "@effect-auth/core/MagicLink";
import { PasswordReset } from "@effect-auth/core/Password";
import { IdentityStore } from "@effect-auth/core/Storage";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { AuthRuntimeConfigSchema } from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";
import { PasswordResetEligibility } from "#/modules/account-security/application/PasswordResetEligibility";
import { RecoverySafeIdentityRejected } from "#/modules/account-security/domain/RecoverySafeIdentityError";
import { makeRecoverySafeAccountSecurityEffectAuthLayer } from "#/modules/account-security/layers/AccountSecurityLayer";
import { RecoverySafeIdentityPolicy } from "#/modules/account-security/ports/RecoverySafeIdentityPolicy";

const baseConfig = {
  delivery: { _tag: "development" },
  emailFrom: "auth@example.test",
  publicOrigin: "https://inbox.test",
  rateLimitNamespace: {},
  secrets: {
    challenge: Redacted.make("BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA"),
    privacy: Redacted.make("CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCA"),
    session: Redacted.make("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
  },
} as const;
const unusedEffectAuthOperation = () =>
  Effect.die("service operation is not used");

describe("auth runtime config", () => {
  it("decodes an exact absolute root origin", () => {
    const config = Schema.decodeUnknownSync(AuthRuntimeConfigSchema)(
      baseConfig
    );

    expect(config.publicOrigin.origin).toBe("https://inbox.test");
    expect(config.publicOrigin.href).toBe("https://inbox.test/");
  });

  it.each([
    "https://user:password@inbox.test",
    "https://inbox.test/path",
    "https://inbox.test?query=true",
    "https://inbox.test#fragment",
  ])("rejects a non-origin URL without normalizing it: %s", (publicOrigin) => {
    expect(() =>
      Schema.decodeUnknownSync(AuthRuntimeConfigSchema)({
        ...baseConfig,
        publicOrigin,
      })
    ).toThrow(/exact HTTP\(S\) root origin/u);
  });

  it("rejects malformed or repeated auth secrets without rendering them", () => {
    const privateValue = "private-secret-that-must-not-appear";
    const renderedErrors = [
      { ...baseConfig.secrets, session: Redacted.make(privateValue) },
      {
        challenge: baseConfig.secrets.session,
        privacy: baseConfig.secrets.privacy,
        session: baseConfig.secrets.session,
      },
    ].map((secrets) => {
      try {
        Schema.decodeUnknownSync(AuthRuntimeConfigSchema)({
          ...baseConfig,
          secrets,
        });
        return privateValue;
      } catch (error) {
        return String(error);
      }
    });
    expect(renderedErrors).toHaveLength(2);
    expect(
      renderedErrors.every((error) => !error.includes(privateValue))
    ).toBeTruthy();
  });

  it("rejects relative and non-HTTP public origins", () => {
    expect(() =>
      Schema.decodeUnknownSync(AuthRuntimeConfigSchema)({
        ...baseConfig,
        publicOrigin: "/relative",
      })
    ).toThrow(/.+/u);
    expect(() =>
      Schema.decodeUnknownSync(AuthRuntimeConfigSchema)({
        ...baseConfig,
        publicOrigin: "ftp://inbox.test",
      })
    ).toThrow(/.+/u);
  });

  it("requires an email sender in production delivery mode", () => {
    expect(() =>
      Schema.decodeUnknownSync(AuthRuntimeConfigSchema)({
        ...baseConfig,
        delivery: { _tag: "production" },
      })
    ).toThrow(/.+/u);
  });

  it("requires HTTPS in production but permits local HTTP development", () => {
    expect(() =>
      Schema.decodeUnknownSync(AuthRuntimeConfigSchema)({
        ...baseConfig,
        delivery: {
          _tag: "production",
          emailSender: { send: () => null },
        },
        publicOrigin: "http://inbox.test",
      })
    ).toThrow(/Production auth requires an HTTPS public origin/u);

    const development = Schema.decodeUnknownSync(AuthRuntimeConfigSchema)({
      ...baseConfig,
      publicOrigin: "http://localhost:3000",
    });
    expect(development.publicOrigin.origin).toBe("http://localhost:3000");
  });
});

describe("account-security effect-auth composition", () => {
  it("enforces policy for composed email-verification code starts", async () => {
    const identityId = IdentityId("identity-a");
    const userId = UserId("user-a");
    const sessionId = SessionId("session-a");
    let policyChecks = 0;
    let rawStarts = 0;
    const rawVerification = EmailVerificationCode.of({
      start: () =>
        Effect.sync(() => {
          rawStarts += 1;
        }).pipe(Effect.andThen(Effect.die("raw verification must not start"))),
      verify: unusedEffectAuthOperation,
    });
    const rawEffectAuth = Layer.mergeAll(
      Layer.mock(Challenge, {}),
      Layer.mock(EmailOtpLogin, {
        start: unusedEffectAuthOperation,
        verify: unusedEffectAuthOperation,
      }),
      Layer.succeed(EmailVerificationCode, rawVerification),
      Layer.mock(MagicLinkLogin, {
        start: unusedEffectAuthOperation,
        verify: unusedEffectAuthOperation,
      }),
      Layer.mock(PasswordReset, {
        start: unusedEffectAuthOperation,
        verify: unusedEffectAuthOperation,
      })
    );
    const composed = makeRecoverySafeAccountSecurityEffectAuthLayer({
      authStorage: Layer.mock(IdentityStore, {
        findById: () =>
          Effect.succeed(
            Option.some({
              createdAt: UnixMillis(1000),
              id: identityId,
              isPrimaryLogin: true,
              kind: "email",
              normalizedValue: "person@example.test",
              scope: { type: "global" },
              updatedAt: UnixMillis(1000),
              userId,
              value: "person@example.test",
            })
          ),
      }),
      passwordResetEligibility: Layer.mock(PasswordResetEligibility, {}),
      rawEffectAuth,
      recoverySafeIdentity: Layer.succeed(
        RecoverySafeIdentityPolicy,
        RecoverySafeIdentityPolicy.of({
          requireSafeAddress: () =>
            Effect.sync(() => {
              policyChecks += 1;
            }).pipe(
              Effect.andThen(
                Effect.fail(
                  new RecoverySafeIdentityRejected({
                    reason: "mailbox-address",
                  })
                )
              )
            ),
        })
      ),
    });

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const verification = yield* EmailVerificationCode;
        return yield* verification
          .start({ identityId, sessionId, userId })
          .pipe(Effect.flip);
      }).pipe(Effect.provide(composed))
    );

    expect(error.message).toBe("Email initiation denied");
    expect(policyChecks).toBe(1);
    expect(rawStarts).toBe(0);
  });
});
