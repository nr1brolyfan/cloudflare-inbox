import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import { WebCryptoLive } from "@effect-auth/core/Crypto";
import type { PasswordHttpOperationsService } from "@effect-auth/core/HttpApi";
import {
  AuthOriginCheckMiddlewareLive,
  AuthSchemaErrorMiddlewareLive,
  PasswordHttpOperations,
} from "@effect-auth/core/HttpApi";
import {
  CredentialId,
  SessionId,
  SessionToken,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import { PasswordHasher } from "@effect-auth/core/Password";
import { PermissionSubject } from "@effect-auth/core/Permission";
import type {
  CurrentSessionShape,
  IssuedSession,
  SessionsService,
  ValidatedSession,
} from "@effect-auth/core/Sessions";
import { SessionCookie, Sessions } from "@effect-auth/core/Sessions";
import type { CredentialStoreService } from "@effect-auth/core/Storage";
import { CredentialStore } from "@effect-auth/core/Storage";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { HttpApiTest } from "effect/unstable/httpapi";
import { describe, expect, it } from "vitest";

import type { PasskeyAuthenticationService } from "#/auth/passkey-authentication";
import {
  PasskeyAuthentication,
  StartedPasskeyAuthentication,
} from "#/auth/passkey-authentication";
import { RequestSessionAuthenticator } from "#/auth/session";
import { SensitiveOperationStepUpClock } from "#/auth/step-up-policy";
import { PasswordEnrollmentUnavailableGroupLive } from "#/http/auth";
import { ApplicationAuthHttpApi } from "#/http/auth-contract";
import {
  ApplicationStepUpHttpOperationsLayer,
  StepUpApiLayer,
} from "#/http/auth-step-up";
import { HttpApiPlatformLive } from "#/http/platform";

const userId = UserId("user-a");
const sessionId = SessionId("session-a");
const token = SessionToken(`${sessionId}.old-secret`);
const credentialId = CredentialId("credential-a");
const passkeyStarted = Schema.decodeUnknownSync(StartedPasskeyAuthentication)({
  challengeId: "passkey-step-up-challenge-a",
  expiresAt: 10_000,
  publicKey: {
    allowCredentials: [{ id: "webauthn-credential-a", type: "public-key" }],
    challenge: "server-challenge",
    rpId: "inbox.test",
    userVerification: "required",
  },
});
const currentSession = {
  aal: "aal1" as const,
  amr: ["magic_link"],
  authenticationEvents: [
    {
      identityId: "identity-a",
      type: "magic_link" as const,
      verifiedAt: UnixMillis(1000),
      version: 1 as const,
    },
  ],
  authTime: UnixMillis(1000),
  expiresAt: UnixMillis(10_000),
  sessionId,
  userId,
};
const validated = {
  actor: { sessionId, userId },
  currentSession,
  issued: { ...currentSession, token },
} satisfies ValidatedSession;
const elevated = {
  ...currentSession,
  amr: ["magic_link", "pwd"],
  authenticationEvents: [
    ...currentSession.authenticationEvents,
    {
      credentialId,
      type: "password" as const,
      verifiedAt: UnixMillis(2000),
      version: 1 as const,
    },
  ],
  authTime: UnixMillis(2000),
  token: SessionToken(`${sessionId}.new-secret`),
} satisfies IssuedSession;

const StepUpClient = HttpApiTest.groups(ApplicationAuthHttpApi, ["stepUp"]);
const PasswordClient = HttpApiTest.groups(ApplicationAuthHttpApi, ["password"]);
const unusedPasswordOperation = () => Effect.die("operation is not used");

const runRestrictedPasswordClient = <A, E>(
  use: (client: Effect.Success<typeof PasswordClient>) => Effect.Effect<A, E>,
  options: {
    readonly onResetStart?: () => void;
    readonly onSet?: () => void;
  } = {}
) => {
  const operations: PasswordHttpOperationsService = {
    change: unusedPasswordOperation,
    resetStart: () =>
      Effect.sync(() => {
        options.onResetStart?.();
        return HttpServerResponse.empty({ status: 204 });
      }),
    resetVerify: unusedPasswordOperation,
    set: () =>
      Effect.sync(() => {
        options.onSet?.();
        return HttpServerResponse.empty({ status: 204 });
      }),
    signIn: unusedPasswordOperation,
    signUp: unusedPasswordOperation,
  };

  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* PasswordClient;
        return yield* use(client);
      }).pipe(
        Effect.provide(PasswordEnrollmentUnavailableGroupLive),
        Effect.provide(Layer.succeed(PasswordHttpOperations, operations)),
        Effect.provide(
          AuthOriginCheckMiddlewareLive({ allowMissingOrigin: true })
        ),
        Effect.provide(AuthSchemaErrorMiddlewareLive),
        Effect.provide(HttpApiPlatformLive),
        Effect.provide(WebCryptoLive()),
        Effect.provide(NodeServices.layer)
      )
    )
  );
};

const makeCredentialStore = (): CredentialStoreService => ({
  findPasswordByUserId: () =>
    Effect.succeed(
      Option.some({
        createdAt: UnixMillis(1000),
        id: credentialId,
        passwordHash: "stored-hash",
        updatedAt: UnixMillis(1000),
        userId,
      })
    ),
  insertPassword: () => Effect.die("insertPassword is not used"),
  updatePassword: () => Effect.die("updatePassword is not used"),
});

const runStepUpClient = <A, E>(
  use: (client: Effect.Success<typeof StepUpClient>) => Effect.Effect<A, E>,
  options: {
    readonly currentSession?: CurrentSessionShape;
    readonly finishPasskey?: PasskeyAuthenticationService["finishStepUp"];
    readonly passwordValid?: boolean;
    readonly passkeyAvailable?: boolean;
    readonly startPasskey?: PasskeyAuthenticationService["startStepUp"];
    readonly onAssure?: SessionsService["assureAndRotate"];
    readonly onCommit?: (issued: IssuedSession) => void;
  } = {}
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* StepUpClient;
        return yield* use(client);
      }).pipe(
        Effect.provide(StepUpApiLayer),
        Effect.provide(ApplicationStepUpHttpOperationsLayer),
        Effect.provide(
          Layer.mock(PasskeyAuthentication, {
            finishSignIn: () => Effect.die("sign-in is not used"),
            finishStepUp:
              options.finishPasskey ??
              (() => Effect.die("passkey step-up is not used")),
            startSignIn: () => Effect.die("sign-in is not used"),
            startStepUp:
              options.startPasskey ??
              (() => Effect.die("passkey step-up is not used")),
            stepUpAvailable: Effect.succeed(options.passkeyAvailable ?? false),
          })
        ),
        Effect.provide(
          Layer.succeed(
            SensitiveOperationStepUpClock,
            SensitiveOperationStepUpClock.of({ now: () => 2000 })
          )
        ),
        Effect.provide(
          Layer.succeed(
            RequestSessionAuthenticator,
            RequestSessionAuthenticator.of({
              authenticate: () => {
                const requestSession = options.currentSession ?? currentSession;
                return Effect.succeed({
                  actor: validated.actor,
                  principal: PermissionSubject.user(userId),
                  requestAuth: {
                    sessionSecretHash: "old-secret-hash",
                    validated: {
                      ...validated,
                      currentSession: requestSession,
                      issued: { ...requestSession, token },
                    },
                  },
                  session: requestSession,
                });
              },
            })
          )
        ),
        Effect.provide(
          Layer.succeed(
            AuthRateLimit,
            AuthRateLimit.of({ require: () => Effect.void })
          )
        ),
        Effect.provide(Layer.succeed(CredentialStore, makeCredentialStore())),
        Effect.provide(
          Layer.succeed(
            PasswordHasher,
            PasswordHasher.of({
              hash: () => Effect.die("hash is not used"),
              verify: ({ hash, password }) =>
                Effect.succeed(
                  hash === "stored-hash" &&
                    Redacted.value(password) === "correct-password" &&
                    options.passwordValid !== false
                ),
            })
          )
        ),
        Effect.provide(
          Layer.succeed(Sessions, {
            assureAndRotate:
              options.onAssure ?? (() => Effect.succeed(elevated)),
          } as SessionsService)
        ),
        Effect.provide(
          Layer.succeed(
            SessionCookie,
            SessionCookie.of({
              clear: Effect.succeed("cleared=1"),
              commit: (issued) =>
                Effect.sync(() => {
                  options.onCommit?.(issued);
                  return "__Host-session=rotated";
                }),
              read: () => Effect.succeed(Option.none()),
            })
          )
        ),
        Effect.provide(
          AuthOriginCheckMiddlewareLive({ allowMissingOrigin: true })
        ),
        Effect.provide(AuthSchemaErrorMiddlewareLive),
        Effect.provide(HttpApiPlatformLive),
        Effect.provide(WebCryptoLive()),
        Effect.provide(NodeServices.layer)
      )
    )
  );

describe("password step-up API", () => {
  it("lists password when the current user has an active credential", async () => {
    const result = await runStepUpClient((client) => client.stepUp.options());

    expect(result).toStrictEqual({ factors: [{ type: "password" }] });
  });

  it("lists and starts a purpose-bound passkey step-up", async () => {
    let starts = 0;
    const options = await runStepUpClient((client) => client.stepUp.options(), {
      passkeyAvailable: true,
    });
    const started = await runStepUpClient(
      (client) => client.stepUp.startPasskey({ payload: {} }),
      {
        passkeyAvailable: true,
        startPasskey: () =>
          Effect.sync(() => {
            starts += 1;
            return passkeyStarted;
          }),
      }
    );

    expect(options.factors).toStrictEqual([
      { type: "password" },
      { type: "passkey" },
    ]);
    expect(started).toMatchObject(passkeyStarted);
    expect(starts).toBe(1);
  });

  it("commits the rotated session after passkey verification", async () => {
    let finishedChallenge: string | undefined;
    let committedToken: string | undefined;

    const result = await runStepUpClient(
      (client) =>
        client.stepUp.verifyPasskey({
          payload: {
            challengeId: passkeyStarted.challengeId,
            credential: {
              id: "browser-credential-a",
              response: { authenticatorData: "signed" },
              type: "public-key",
            },
          },
        }),
      {
        finishPasskey: (command) => {
          finishedChallenge = command.challengeId;
          return Effect.succeed(elevated);
        },
        onCommit: (issued) => {
          committedToken = issued.token;
        },
      }
    );

    expect(result).toMatchObject({ aal: "aal1", type: "authenticated" });
    expect(finishedChallenge).toBe(passkeyStarted.challengeId);
    expect(committedToken).toBe(elevated.token);
  });

  it("rotates the session after verifying the password", async () => {
    let assuredToken: string | undefined;
    let committedToken: string | undefined;
    const result = await runStepUpClient(
      (client) =>
        client.stepUp.verifyPassword({
          payload: { password: "correct-password" },
        }),
      {
        onAssure: (input) => {
          assuredToken = input.token;
          expect(input).toMatchObject({
            evidence: { credentialId, type: "password", version: 1 },
            reason: "step_up",
          });
          return Effect.succeed(elevated);
        },
        onCommit: (issued) => {
          committedToken = issued.token;
        },
      }
    );

    expect(result).toMatchObject({ aal: "aal1", type: "authenticated" });
    expect(assuredToken).toBe(token);
    expect(committedToken).toBe(elevated.token);
  });

  it("rejects an invalid password without rotating the session", async () => {
    let rotations = 0;
    const error = await runStepUpClient(
      (client) =>
        client.stepUp
          .verifyPassword({ payload: { password: "wrong-password" } })
          .pipe(Effect.flip),
      {
        onAssure: () => {
          rotations += 1;
          return Effect.succeed(elevated);
        },
      }
    );

    expect(error).toMatchObject({
      _tag: "AuthInvalidCredentialsError",
      code: "invalid_credentials",
    });
    expect(rotations).toBe(0);
  });

  const restrictedSession = {
    ...currentSession,
    claims: { requirements: ["email_verification"] },
  } satisfies CurrentSessionShape;

  it("rejects options for a restricted session", async () => {
    const error = await runStepUpClient(
      (client) => client.stepUp.options().pipe(Effect.flip),
      { currentSession: restrictedSession }
    );

    expect(error).toMatchObject({
      _tag: "AuthPolicyDeniedError",
      code: "policy_denied",
    });
  });

  it("rejects password verification for a restricted session", async () => {
    const error = await runStepUpClient(
      (client) =>
        client.stepUp
          .verifyPassword({ payload: { password: "correct-password" } })
          .pipe(Effect.flip),
      { currentSession: restrictedSession }
    );

    expect(error).toMatchObject({
      _tag: "AuthPolicyDeniedError",
      code: "policy_denied",
    });
  });
});

describe("password enrollment guard", () => {
  it("keeps public password sign-up unavailable", async () => {
    const error = await runRestrictedPasswordClient((client) =>
      client.password
        .signUp({
          payload: {
            identity: {
              kind: "email",
              scope: { type: "global" },
              value: "person@example.test",
            },
            password: "correct-password",
          },
        })
        .pipe(Effect.flip)
    );

    expect(error).toMatchObject({
      _tag: "AuthPolicyDeniedError",
      code: "policy_denied",
    });
  });

  it("keeps first-password enrollment unavailable", async () => {
    let passwordSets = 0;
    const error = await runRestrictedPasswordClient(
      (client) =>
        client.password
          .set({ payload: { password: "correct-password" } })
          .pipe(Effect.flip),
      {
        onSet: () => {
          passwordSets += 1;
        },
      }
    );

    expect(error).toMatchObject({
      _tag: "AuthPolicyDeniedError",
      code: "policy_denied",
    });
    expect(passwordSets).toBe(0);
  });

  it("always delegates reset start through the guarded operation", async () => {
    let starts = 0;

    await runRestrictedPasswordClient(
      (client) =>
        client.password.resetStart({
          payload: {
            identity: {
              kind: "email",
              scope: { type: "global" },
              value: "person@example.test",
            },
          },
        }),
      {
        onResetStart: () => {
          starts += 1;
        },
      }
    );

    expect(starts).toBe(1);
  });
});
