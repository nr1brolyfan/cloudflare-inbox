import { emptyCustomEvidencePolicyRegistry } from "@effect-auth/core/Assurance";
import { AuthResult } from "@effect-auth/core/AuthFlow";
import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import { Challenge } from "@effect-auth/core/Challenge";
import { EmailOtpLogin } from "@effect-auth/core/EmailOtp";
import { EmailVerificationFlow } from "@effect-auth/core/EmailVerification";
import {
  AuthHttp,
  PasswordHttpOperations,
  PasswordHttpOperationsLive,
} from "@effect-auth/core/HttpApi";
import {
  AuthFlowId,
  IdentityId,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import { MagicLinkLogin } from "@effect-auth/core/MagicLink";
import type { PasswordLoginService } from "@effect-auth/core/Password";
import {
  PasswordLogin,
  PasswordManagement,
  PasswordRegistration,
  PasswordReset,
} from "@effect-auth/core/Password";
import { SessionCookie, Sessions } from "@effect-auth/core/Sessions";
import { IdentityStore } from "@effect-auth/core/Storage";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { describe, expect, it } from "vitest";

import { AuthRuntimeConfigSchema } from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";
import { PasswordResetEligibility } from "#/modules/account-security/application/PasswordResetEligibility";
import { RecoverySafeIdentityRejected } from "#/modules/account-security/domain/RecoverySafeIdentityError";
import { makeRecoverySafeAccountSecurityEffectAuthLayer } from "#/modules/account-security/layers/AccountSecurityLayer";
import { RecoverySafeIdentityPolicy } from "#/modules/account-security/ports/RecoverySafeIdentityPolicy";

const baseConfig = {
  delivery: { _tag: "development" },
  emailFrom: "auth@example.test",
  publicOrigin: "https://inbox.test/some/deployment/path?ignored=true",
  rateLimitNamespace: {},
  secrets: {
    challenge: Redacted.make("challenge"),
    privacy: Redacted.make("privacy"),
    session: Redacted.make("session"),
  },
} as const;
const unusedEffectAuthOperation = () =>
  Effect.die("service operation is not used");

describe("auth runtime config", () => {
  it("decodes an absolute origin whose origin is normalized", () => {
    const config = Schema.decodeUnknownSync(AuthRuntimeConfigSchema)(
      baseConfig
    );

    expect(config.publicOrigin.origin).toBe("https://inbox.test");
    expect(config.publicOrigin.href).toBe("https://inbox.test/");
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
  it("enforces policy for verification started internally by password sign-in", async () => {
    const identityId = IdentityId("identity-a");
    const userId = UserId("user-a");
    let policyChecks = 0;
    let rawStarts = 0;
    const rawVerification = EmailVerificationFlow.of({
      start: () =>
        Effect.sync(() => {
          rawStarts += 1;
        }).pipe(Effect.andThen(Effect.die("raw verification must not start"))),
    });
    const password: PasswordLoginService = {
      signIn: () =>
        Effect.succeed(
          AuthResult.RequiresEmailVerification({
            flowId: AuthFlowId("flow-a"),
            identityId,
            userId,
          })
        ),
    };
    const rawEffectAuth = Layer.mergeAll(
      Layer.mock(Challenge, {}),
      Layer.mock(EmailOtpLogin, {
        start: unusedEffectAuthOperation,
        verify: unusedEffectAuthOperation,
      }),
      Layer.succeed(EmailVerificationFlow, rawVerification),
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

    const operationsLayer = PasswordHttpOperationsLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          composed,
          Layer.succeed(PasswordLogin, password),
          Layer.mock(PasswordManagement, {}),
          Layer.mock(PasswordRegistration, {}),
          Layer.mock(SessionCookie, {}),
          Layer.mock(Sessions, {
            customEvidencePolicies: emptyCustomEvidencePolicyRegistry,
          }),
          Layer.mock(AuthHttp, {
            commitPasswordSignInResult: () =>
              Effect.succeed(HttpServerResponse.empty({ status: 200 })),
          }),
          Layer.succeed(
            AuthRateLimit,
            AuthRateLimit.of({ require: () => Effect.void })
          )
        )
      )
    );

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const operations = yield* PasswordHttpOperations;
        return yield* operations
          .signIn({
            payload: {
              identity: {
                kind: "email",
                scope: { type: "global" },
                value: "person@example.test",
              },
              password: "password",
            },
            request: HttpServerRequest.fromWeb(
              new Request("https://inbox.test/auth/password/sign-in")
            ),
          })
          .pipe(Effect.flip);
      }).pipe(Effect.provide(operationsLayer))
    );

    expect(error).toMatchObject({
      _tag: "AuthInternalError",
      code: "internal_error",
      message: "Failed to start email verification",
    });
    expect(policyChecks).toBe(1);
    expect(rawStarts).toBe(0);
  });
});
