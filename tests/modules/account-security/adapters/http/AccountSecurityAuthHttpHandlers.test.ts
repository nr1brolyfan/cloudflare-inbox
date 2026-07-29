import { BotProtectionNoopLive } from "@effect-auth/core/AbuseProtection";
import { emptyCustomEvidencePolicyRegistry } from "@effect-auth/core/Assurance";
import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import type { EmailAuthProcessCredential } from "@effect-auth/core/EmailAuthProcess";
import type { EmailOtpLoginService } from "@effect-auth/core/EmailOtp";
import { EmailOtpLogin, EmailOtpStartError } from "@effect-auth/core/EmailOtp";
import type { EmailVerificationCodeService } from "@effect-auth/core/EmailVerificationCode";
import {
  EmailVerificationCode,
  EmailVerificationCodeStartError,
} from "@effect-auth/core/EmailVerificationCode";
import {
  AuthOriginCheckMiddleware,
  AuthOriginCheckMiddlewareLive,
  AuthSchemaErrorMiddlewareLive,
  CoreAuthHttpApi,
  EmailOtpHttpOperations,
  EmailVerificationHttpOperations,
  MagicLinkHttpOperations,
} from "@effect-auth/core/HttpApi";
import { EmailAuthProcessCookie } from "@effect-auth/core/HttpApi/EmailOtp";
import {
  HttpBotVerifierCapability,
  HttpLoginRiskEnricherCapability,
  HttpTrustedDeviceCookieCapability,
  layerNoDeps as httpAuthenticationCapabilitiesLayerNoDeps,
} from "@effect-auth/core/HttpApi/HttpAuthenticationCapabilities";
import {
  ChallengeId,
  Email,
  IdentityId,
  SessionId,
  SessionToken,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import type { MagicLinkLoginService } from "@effect-auth/core/MagicLink";
import {
  MagicLinkLogin,
  MagicLinkStartError,
} from "@effect-auth/core/MagicLink";
import { SessionCookie, Sessions } from "@effect-auth/core/Sessions";
import { IdentityStore, StorageError } from "@effect-auth/core/Storage";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Brand from "effect/Brand";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import { HttpApiTest } from "effect/unstable/httpapi";
import type * as HttpApiMiddleware from "effect/unstable/httpapi/HttpApiMiddleware";
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
const sessionId = SessionId("session-a");
const sessionToken = SessionToken("session-a.secret");
const userId = UserId("user-a");
const storedIdentity = {
  createdAt: UnixMillis(1000),
  id: identityId,
  isPrimaryLogin: true,
  kind: "email" as const,
  normalizedValue: "person@example.com",
  scope: { type: "global" as const },
  updatedAt: UnixMillis(1000),
  userId,
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
const publicOrigin = "https://inbox.test";
const emailAuthProcessCredential =
  Brand.nominal<EmailAuthProcessCredential>()("email-process-a");
const authProcess = {
  challengeId: ChallengeId("email-process-a"),
  credential: Redacted.make(emailAuthProcessCredential),
  expiresAt: UnixMillis(1000),
};
const validatedSession = {
  actor: { sessionId, userId },
  currentSession: {
    aal: "aal1" as const,
    amr: ["password"],
    authenticationEvents: [],
    authTime: UnixMillis(500),
    expiresAt: UnixMillis(2000),
    sessionId,
    userId,
  },
  issued: {
    aal: "aal1" as const,
    amr: ["password"],
    authenticationEvents: [],
    authTime: UnixMillis(500),
    expiresAt: UnixMillis(2000),
    sessionId,
    token: sessionToken,
    userId,
  },
};
const httpAuthenticationCapabilitiesLayer =
  httpAuthenticationCapabilitiesLayerNoDeps({
    botVerifier: HttpBotVerifierCapability.Disabled(),
    loginRiskEnricher: HttpLoginRiskEnricherCapability.Disabled(),
    trustedDeviceCookie: HttpTrustedDeviceCookieCapability.Disabled(),
  }).pipe(Layer.orDie);
const AuthOriginCheckClient = Context.Service<
  HttpApiMiddleware.HttpApiMiddlewareClient<never, never, never>
>(`${AuthOriginCheckMiddleware.key}/Client`);
const authOriginCheckClientLayer = Layer.succeed(
  AuthOriginCheckClient,
  ({ next, request }) =>
    next(HttpClientRequest.setHeader(request, "origin", publicOrigin))
);
const authOriginCheckLayer = AuthOriginCheckMiddlewareLive({
  mode: "secure",
  origins: [publicOrigin],
}).pipe(Layer.orDie);

const runEmailOtpClient = <A, E>(
  use: (client: Effect.Success<typeof EmailOtpClient>) => Effect.Effect<A, E>,
  options: {
    readonly onGuard?: (operation: string) => void;
    readonly onProcessCommit?: (process: typeof authProcess) => void;
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
                    authProcess,
                    challengeId: ChallengeId("challenge-a"),
                    email: Email("person@example.com"),
                    expiresAt: UnixMillis(1000),
                  };
                })),
          })
        ),
        Effect.provide(
          Layer.mock(EmailAuthProcessCookie, {
            commit: (process) =>
              Effect.sync(() => {
                options.onProcessCommit?.(process);
                return "__Host-email-auth-process=fixture";
              }),
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
        Effect.provide(httpAuthenticationCapabilitiesLayer),
        Effect.provide(authOriginCheckLayer),
        Effect.provide(authOriginCheckClientLayer),
        Effect.provide(AuthSchemaErrorMiddlewareLive),
        Effect.provide(HttpApiPlatformLayer),
        Effect.provide(NodeServices.layer)
      )
    )
  );

describe("restricted email OTP API", () => {
  it("delegates valid start requests to the effect-auth operation", async () => {
    let committedProcess: typeof authProcess | undefined;
    const result = await runEmailOtpClient(
      (client) => client.emailOtp.start({ payload: { identity } }),
      {
        onProcessCommit: (process) => {
          committedProcess = process;
        },
      }
    );

    expect(result).toStrictEqual({
      challengeId: "challenge-a",
      expiresAt: 1000,
      identity,
    });
    expect(committedProcess).toStrictEqual(authProcess);
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
        Effect.provide(httpAuthenticationCapabilitiesLayer),
        Effect.provide(authOriginCheckLayer),
        Effect.provide(authOriginCheckClientLayer),
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
    readonly start?: EmailVerificationCodeService["start"];
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
          Layer.mock(EmailVerificationCode, {
            start:
              options.start ??
              (() =>
                Effect.succeed({
                  challengeId: ChallengeId("verification-a"),
                  expiresAt: UnixMillis(1000),
                  identityId,
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
          Layer.mock(Sessions, {
            customEvidencePolicies: emptyCustomEvidencePolicyRegistry,
            validate: () => Effect.succeed(validatedSession),
          })
        ),
        Effect.provide(
          Layer.mock(SessionCookie, {
            read: () => Effect.succeed(Option.some(sessionToken)),
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
        Effect.provide(httpAuthenticationCapabilitiesLayer),
        Effect.provide(authOriginCheckLayer),
        Effect.provide(authOriginCheckClientLayer),
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
    ).resolves.toStrictEqual({
      challengeId: "verification-a",
      expiresAt: 1000,
    });
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
            new EmailVerificationCodeStartError({
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

  it("maps verification storage failure to sanitized internal error", async () => {
    const error = await runEmailVerificationClient(
      (client) =>
        client.emailVerification
          .start({ payload: { identityId } })
          .pipe(Effect.flip),
      {
        start: () =>
          Effect.fail(
            new EmailVerificationCodeStartError({
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
