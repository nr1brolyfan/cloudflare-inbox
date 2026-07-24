import { BotProtectionNoopLive } from "@effect-auth/core/AbuseProtection";
import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import type { EmailOtpLoginService } from "@effect-auth/core/EmailOtp";
import { EmailOtpLogin, EmailOtpStartError } from "@effect-auth/core/EmailOtp";
import type { EmailVerificationFlowService } from "@effect-auth/core/EmailVerification";
import {
  EmailVerificationFlow,
  EmailVerificationFlowStartError,
  EmailVerificationIssueError,
} from "@effect-auth/core/EmailVerification";
import {
  AuthOriginCheckMiddlewareLive,
  AuthSchemaErrorMiddlewareLive,
  CoreAuthHttpApi,
  EmailOtpHttpOperations,
  EmailVerificationHttpOperations,
  MagicLinkHttpOperations,
} from "@effect-auth/core/HttpApi";
import {
  ChallengeId,
  Email,
  IdentityId,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import type { MagicLinkLoginService } from "@effect-auth/core/MagicLink";
import {
  MagicLinkLogin,
  MagicLinkStartError,
} from "@effect-auth/core/MagicLink";
import { IdentityStore, StorageError } from "@effect-auth/core/Storage";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpApiTest } from "effect/unstable/httpapi";
import { describe, expect, it } from "vitest";

import { RecoverySafeEmailInitiationDenied } from "#/modules/account-security/adapters/effect-auth/RecoverySafeEmailInitiationEffectAuth";
import {
  RestrictedEmailOtpHttpHandlersLayer,
  RestrictedEmailVerificationHttpHandlersLayer,
  RestrictedMagicLinkHttpHandlersLayer,
} from "#/modules/account-security/adapters/http/AccountSecurityAuthHttpHandlers";
import { HttpApiPlatformLayer } from "#/platform/cloudflare/HttpApiPlatform";

const identity = {
  kind: "email",
  scope: { type: "global" as const },
  value: "person@example.com",
};
const identityId = IdentityId("identity-a");
const storedIdentity = {
  createdAt: UnixMillis(1000),
  id: identityId,
  isPrimaryLogin: true,
  kind: "email" as const,
  normalizedValue: "person@example.com",
  scope: { type: "global" as const },
  updatedAt: UnixMillis(1000),
  userId: UserId("user-a"),
  value: "person@example.com",
};
const storageError = () =>
  new StorageError({
    entity: "verification",
    message: "database unavailable",
    operation: "insert",
  });
const EmailOtpClient = HttpApiTest.groups(CoreAuthHttpApi, ["emailOtp"]);
const MagicLinkClient = HttpApiTest.groups(CoreAuthHttpApi, ["magicLink"]);
const EmailVerificationClient = HttpApiTest.groups(CoreAuthHttpApi, [
  "emailVerification",
]);

const runEmailOtpClient = <A, E>(
  use: (client: Effect.Success<typeof EmailOtpClient>) => Effect.Effect<A, E>,
  options: {
    readonly onGuard?: (operation: string) => void;
    readonly onStart?: () => void;
    readonly start?: EmailOtpLoginService["start"];
  } = {}
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* EmailOtpClient;
        return yield* use(client);
      }).pipe(
        Effect.provide(RestrictedEmailOtpHttpHandlersLayer),
        Effect.provide(BotProtectionNoopLive),
        Effect.provide(
          Layer.mock(EmailOtpLogin, {
            start:
              options.start ??
              (() =>
                Effect.sync(() => {
                  options.onStart?.();
                  return {
                    challengeId: ChallengeId("challenge-a"),
                    email: Email("person@example.com"),
                    expiresAt: UnixMillis(1000),
                  };
                })),
          })
        ),
        Effect.provide(
          Layer.succeed(
            AuthRateLimit,
            AuthRateLimit.of({
              require: (input) =>
                Effect.sync(() => options.onGuard?.(input.operation)),
            })
          )
        ),
        Effect.provide(
          Layer.succeed(
            EmailOtpHttpOperations,
            EmailOtpHttpOperations.of({
              start: () => Effect.die("operation start is not used"),
              verify: () => Effect.die("verify is not used by this test"),
            })
          )
        ),
        Effect.provide(
          AuthOriginCheckMiddlewareLive({ allowMissingOrigin: true })
        ),
        Effect.provide(AuthSchemaErrorMiddlewareLive),
        Effect.provide(HttpApiPlatformLayer),
        Effect.provide(NodeServices.layer)
      )
    )
  );

describe("restricted email OTP API", () => {
  it("delegates valid start requests to the effect-auth operation", async () => {
    const result = await runEmailOtpClient((client) =>
      client.emailOtp.start({ payload: { identity } })
    );

    expect(result).toStrictEqual({
      challengeId: "challenge-a",
      expiresAt: 1000,
      identity,
    });
  });

  it("rejects caller-provided secrets before the operation", async () => {
    const guardedOperations: string[] = [];
    let starts = 0;
    const error = await runEmailOtpClient(
      (client) =>
        client.emailOtp
          .start({ payload: { identity, secret: "attacker-secret" } })
          .pipe(Effect.flip),
      {
        onGuard: (operation) => {
          guardedOperations.push(operation);
        },
        onStart: () => {
          starts += 1;
        },
      }
    );

    expect(error).toMatchObject({
      _tag: "AuthBadRequestError",
      code: "bad_request",
      message: "Invalid email OTP request",
    });
    expect(guardedOperations).toStrictEqual(["auth.email_otp.start"]);
    expect(starts).toBe(0);
  });

  it("maps service policy denial to the generic public contract", async () => {
    const error = await runEmailOtpClient(
      (client) =>
        client.emailOtp.start({ payload: { identity } }).pipe(Effect.flip),
      {
        start: () =>
          Effect.fail(
            new EmailOtpStartError({
              cause: new RecoverySafeEmailInitiationDenied(),
              message: "Email initiation denied",
            })
          ),
      }
    );

    expect(error).toMatchObject({
      _tag: "AuthPolicyDeniedError",
      code: "policy_denied",
      message: "Email initiation denied",
    });
  });

  it("maps non-denial service failures to sanitized internal error", async () => {
    const error = await runEmailOtpClient(
      (client) =>
        client.emailOtp.start({ payload: { identity } }).pipe(Effect.flip),
      {
        start: () =>
          Effect.fail(
            new EmailOtpStartError({
              cause: new Error("database unavailable"),
              message: "Failed to evaluate email initiation policy",
            })
          ),
      }
    );

    expect(error).toMatchObject({
      _tag: "AuthInternalError",
      code: "internal_error",
      message: "Failed to start email OTP",
    });
  });
});

const runMagicLinkClient = <A, E>(
  use: (client: Effect.Success<typeof MagicLinkClient>) => Effect.Effect<A, E>,
  options: {
    readonly onGuard?: (operation: string) => void;
    readonly start?: MagicLinkLoginService["start"];
  } = {}
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* MagicLinkClient;
        return yield* use(client);
      }).pipe(
        Effect.provide(RestrictedMagicLinkHttpHandlersLayer),
        Effect.provide(BotProtectionNoopLive),
        Effect.provide(
          Layer.mock(MagicLinkLogin, {
            start:
              options.start ??
              (() =>
                Effect.succeed({
                  challengeId: ChallengeId("magic-a"),
                  email: Email("person@example.com"),
                  expiresAt: UnixMillis(1000),
                })),
          })
        ),
        Effect.provide(
          Layer.mock(MagicLinkHttpOperations, {
            verify: () => Effect.die("verify is not used"),
          })
        ),
        Effect.provide(
          Layer.succeed(
            AuthRateLimit,
            AuthRateLimit.of({
              require: (input) =>
                Effect.sync(() => options.onGuard?.(input.operation)),
            })
          )
        ),
        Effect.provide(
          AuthOriginCheckMiddlewareLive({ allowMissingOrigin: true })
        ),
        Effect.provide(AuthSchemaErrorMiddlewareLive),
        Effect.provide(HttpApiPlatformLayer),
        Effect.provide(NodeServices.layer)
      )
    )
  );

const runEmailVerificationClient = <A, E>(
  use: (
    client: Effect.Success<typeof EmailVerificationClient>
  ) => Effect.Effect<A, E>,
  options: {
    readonly onGuard?: (operation: string) => void;
    readonly start?: EmailVerificationFlowService["start"];
  } = {}
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* EmailVerificationClient;
        return yield* use(client);
      }).pipe(
        Effect.provide(RestrictedEmailVerificationHttpHandlersLayer),
        Effect.provide(BotProtectionNoopLive),
        Effect.provide(
          Layer.mock(EmailVerificationFlow, {
            start:
              options.start ??
              (() =>
                Effect.succeed({
                  challengeId: ChallengeId("verification-a"),
                  email: Email("person@example.com"),
                  expiresAt: UnixMillis(1000),
                  identityId,
                  userId: storedIdentity.userId,
                })),
          })
        ),
        Effect.provide(
          Layer.mock(EmailVerificationHttpOperations, {
            verify: () => Effect.die("verify is not used"),
          })
        ),
        Effect.provide(
          Layer.mock(IdentityStore, {
            findById: () => Effect.succeed(Option.some(storedIdentity)),
          })
        ),
        Effect.provide(
          Layer.succeed(
            AuthRateLimit,
            AuthRateLimit.of({
              require: (input) =>
                Effect.sync(() => options.onGuard?.(input.operation)),
            })
          )
        ),
        Effect.provide(
          AuthOriginCheckMiddlewareLive({ allowMissingOrigin: true })
        ),
        Effect.provide(AuthSchemaErrorMiddlewareLive),
        Effect.provide(HttpApiPlatformLayer),
        Effect.provide(NodeServices.layer)
      )
    )
  );

describe("restricted email-link APIs", () => {
  it("starts a valid magic link", async () => {
    const result = await runMagicLinkClient((client) =>
      client.magicLink.start({ payload: { identity } })
    );

    expect(result).toStrictEqual({
      expiresAt: 1000,
      identity,
    });
  });

  it("runs the magic-link guard before rejecting caller-provided secrets", async () => {
    const guardedOperations: string[] = [];
    let starts = 0;
    const error = await runMagicLinkClient(
      (client) =>
        client.magicLink
          .start({ payload: { identity, secret: "attacker-secret" } })
          .pipe(Effect.flip),
      {
        onGuard: (operation) => {
          guardedOperations.push(operation);
        },
        start: () =>
          Effect.sync(() => {
            starts += 1;
          }).pipe(Effect.andThen(Effect.die("unreachable"))),
      }
    );

    expect(error).toMatchObject({
      _tag: "AuthBadRequestError",
      code: "bad_request",
      message: "Invalid magic link request",
    });
    expect(guardedOperations).toStrictEqual(["auth.magic_link.start"]);
    expect(starts).toBe(0);
  });

  it.each([
    [
      "policy denial",
      new MagicLinkStartError({
        cause: new RecoverySafeEmailInitiationDenied(),
        message: "Email initiation denied",
      }),
      { _tag: "AuthPolicyDeniedError", code: "policy_denied" },
    ],
    [
      "storage failure",
      new MagicLinkStartError({
        cause: storageError(),
        message: "Failed to evaluate email initiation policy",
      }),
      { _tag: "AuthInternalError", code: "internal_error" },
    ],
  ] as const)("maps magic-link %s", async (_, failure, expected) => {
    const error = await runMagicLinkClient(
      (client) =>
        client.magicLink.start({ payload: { identity } }).pipe(Effect.flip),
      { start: () => Effect.fail(failure) }
    );
    expect(error).toMatchObject(expected);
  });

  it("starts valid email verification", async () => {
    await expect(
      runEmailVerificationClient((client) =>
        client.emailVerification.start({ payload: { identityId } })
      )
    ).resolves.toBeUndefined();
  });

  it("runs the verification guard before rejecting caller-provided secrets", async () => {
    const guardedOperations: string[] = [];
    let starts = 0;
    const error = await runEmailVerificationClient(
      (client) =>
        client.emailVerification
          .start({ payload: { identityId, secret: "attacker-secret" } })
          .pipe(Effect.flip),
      {
        onGuard: (operation) => {
          guardedOperations.push(operation);
        },
        start: () =>
          Effect.sync(() => {
            starts += 1;
          }).pipe(Effect.andThen(Effect.die("unreachable"))),
      }
    );

    expect(error).toMatchObject({
      _tag: "AuthBadRequestError",
      code: "bad_request",
      message: "Invalid email verification request",
    });
    expect(guardedOperations).toStrictEqual(["auth.email_verification.start"]);
    expect(starts).toBe(0);
  });

  it("maps verification policy denial to policy_denied", async () => {
    const error = await runEmailVerificationClient(
      (client) =>
        client.emailVerification
          .start({ payload: { identityId } })
          .pipe(Effect.flip),
      {
        start: () =>
          Effect.fail(
            new EmailVerificationFlowStartError({
              cause: new RecoverySafeEmailInitiationDenied(),
              message: "Email initiation denied",
            })
          ),
      }
    );

    expect(error).toMatchObject({
      _tag: "AuthPolicyDeniedError",
      code: "policy_denied",
    });
  });

  it("maps raced vendor issue to anonymized bad_request", async () => {
    const error = await runEmailVerificationClient(
      (client) =>
        client.emailVerification
          .start({ payload: { identityId } })
          .pipe(Effect.flip),
      {
        start: () =>
          Effect.fail(
            new EmailVerificationFlowStartError({
              cause: new EmailVerificationIssueError({
                message: "Email is already verified",
              }),
              message: "Failed to issue email verification",
            })
          ),
      }
    );

    expect(error).toMatchObject({
      _tag: "AuthBadRequestError",
      code: "bad_request",
      message: "Invalid email verification request",
    });
  });

  it("maps verification storage failure to sanitized internal error", async () => {
    const error = await runEmailVerificationClient(
      (client) =>
        client.emailVerification
          .start({ payload: { identityId } })
          .pipe(Effect.flip),
      {
        start: () =>
          Effect.fail(
            new EmailVerificationFlowStartError({
              cause: storageError(),
              message: "Failed to resolve email verification identity",
            })
          ),
      }
    );

    expect(error).toMatchObject({
      _tag: "AuthInternalError",
      code: "internal_error",
      message: "Failed to start email verification",
    });
  });
});
