import { AuthSecretsLive } from "@effect-auth/core/AuthConfig";
import { WebCryptoLive } from "@effect-auth/core/Crypto";
import {
  AuthInternalError,
  AuthUnauthenticatedError,
} from "@effect-auth/core/HttpApi";
import {
  SessionId,
  SessionToken,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import { CurrentPrincipal } from "@effect-auth/core/Permission";
import type {
  SessionsService,
  ValidatedSession,
} from "@effect-auth/core/Sessions";
import {
  CurrentActor,
  CurrentSession,
  makeSessionCookie,
  SessionCookie,
  Sessions,
  SessionValidateError,
} from "@effect-auth/core/Sessions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { describe, expect, it } from "vitest";

import {
  CurrentRequestAuth,
  CurrentValidatedSession,
  makeCurrentRequestAuthLive,
  validateRequestSession,
} from "./session";

const userId = UserId("trusted-user");
const sessionId = SessionId("session-a");
const token = SessionToken(`${sessionId}.secret`);
const authTime = UnixMillis(1000);
const expiresAt = UnixMillis(2000);
const currentSession = {
  aal: "aal1",
  amr: [],
  authenticationEvents: [],
  authTime,
  expiresAt,
  sessionId,
  userId,
} as const;
const actor = { sessionId, userId } as const;
const validatedSession = {
  actor,
  currentSession,
  issued: {
    ...currentSession,
    token,
  },
} satisfies ValidatedSession;

const makeSessionServicesLive = (validate: SessionsService["validate"]) =>
  Layer.mergeAll(
    Layer.succeed(SessionCookie, makeSessionCookie()),
    Layer.succeed(Sessions, Sessions.of({ validate } as SessionsService)),
    WebCryptoLive(),
    AuthSecretsLive({
      challenge: Redacted.make("challenge-secret"),
      privacy: Redacted.make("privacy-secret"),
      session: Redacted.make("session-secret"),
    })
  );

const requestWithSession = (url = "https://inbox.test/private") =>
  new Request(url, {
    headers: {
      cookie: `__Host-session=${token}`,
      "x-user-id": "attacker-controlled-user",
    },
  });

const readCurrentContexts = Effect.all({
  actor: CurrentActor,
  principal: CurrentPrincipal,
  requestAuth: CurrentRequestAuth,
  session: CurrentSession,
  validated: CurrentValidatedSession,
});

describe("current request auth", () => {
  it("derives all contexts once from the validated session", async () => {
    let validations = 0;
    const servicesLive = makeSessionServicesLive(() =>
      Effect.sync(() => {
        validations += 1;
        return validatedSession;
      })
    );
    const request = requestWithSession(
      "https://inbox.test/private?userId=attacker-controlled-user"
    );
    const contexts = await Effect.runPromise(
      readCurrentContexts.pipe(
        Effect.provide(makeCurrentRequestAuthLive(request)),
        Effect.provide(servicesLive)
      )
    );

    expect(contexts).toMatchObject({
      actor,
      principal: { id: userId, type: "user" },
      requestAuth: { validated: validatedSession },
      session: currentSession,
      validated: validatedSession,
    });
    expect(contexts.requestAuth.sessionSecretHash).toHaveLength(43);
    expect(validations).toBe(1);
  });

  it("rejects a request without a session cookie before validation", async () => {
    let validations = 0;
    const servicesLive = makeSessionServicesLive(() => {
      validations += 1;
      return Effect.succeed(validatedSession);
    });
    const error = await Effect.runPromise(
      validateRequestSession(new Request("https://inbox.test/private")).pipe(
        Effect.flip,
        Effect.provide(servicesLive)
      )
    );

    expect(error).toBeInstanceOf(AuthUnauthenticatedError);
    expect(validations).toBe(0);
  });

  it("maps invalid sessions to a generic unauthenticated error", async () => {
    const servicesLive = makeSessionServicesLive(() =>
      Effect.fail(new SessionValidateError({ message: "Session expired" }))
    );
    const error = await Effect.runPromise(
      validateRequestSession(requestWithSession()).pipe(
        Effect.flip,
        Effect.provide(servicesLive)
      )
    );

    expect(error).toBeInstanceOf(AuthUnauthenticatedError);
    expect(error).toMatchObject({
      code: "unauthenticated",
      message: "Unauthenticated",
    });
  });

  it("keeps session infrastructure failures internal", async () => {
    const servicesLive = makeSessionServicesLive(() =>
      Effect.fail(
        new SessionValidateError({
          cause: new Error("D1 unavailable"),
          message: "Failed to load session",
        })
      )
    );
    const error = await Effect.runPromise(
      validateRequestSession(requestWithSession()).pipe(
        Effect.flip,
        Effect.provide(servicesLive)
      )
    );

    expect(error).toBeInstanceOf(AuthInternalError);
    expect(error).toMatchObject({
      code: "internal_error",
      message: "Failed to validate session",
    });
    expect(error).not.toHaveProperty("cause");
  });
});
