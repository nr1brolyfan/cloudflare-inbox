import { AuthSecretsLive } from "@effect-auth/core/AuthConfig";
import {
  Crypto,
  CryptoError,
  makeWebCrypto,
  WebCryptoLive,
} from "@effect-auth/core/Crypto";
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
import type {
  SessionsService,
  ValidatedSession,
} from "@effect-auth/core/Sessions";
import {
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
  RequestSessionAuthenticator,
  RequestSessionAuthenticatorEffectAuthLayer,
} from "#/modules/account-security/adapters/http/RequestSessionAuthentication";

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

const makeSessionServicesLive = (
  validate: SessionsService["validate"],
  cryptoLive = WebCryptoLive()
) =>
  Layer.mergeAll(
    Layer.effect(SessionCookie, makeSessionCookie()),
    Layer.succeed(Sessions, Sessions.of({ validate } as SessionsService)),
    cryptoLive,
    AuthSecretsLive({
      challenge: Redacted.make("challenge-secret".repeat(3)),
      privacy: Redacted.make("privacy-secret".repeat(3)),
      session: Redacted.make("session-secret".repeat(3)),
    })
  );

const requestWithSession = (url = "https://inbox.test/private") =>
  new Request(url, {
    headers: {
      cookie: `__Host-session=${token}`,
      "x-user-id": "attacker-controlled-user",
    },
  });

const authenticate = (
  request: Request,
  validate: SessionsService["validate"],
  cryptoLive = WebCryptoLive()
) =>
  RequestSessionAuthenticator.pipe(
    Effect.flatMap((authenticator) => authenticator.authenticate(request)),
    Effect.provide(
      RequestSessionAuthenticatorEffectAuthLayer.pipe(
        Layer.provide(makeSessionServicesLive(validate, cryptoLive))
      )
    )
  );

describe("request session authenticator", () => {
  it("derives every trusted value from exactly one validation and HMAC", async () => {
    let validations = 0;
    let hmacData: string | Uint8Array | undefined;
    const webCrypto = makeWebCrypto();
    const cryptoLive = Layer.succeed(
      Crypto,
      Crypto.of({
        ...webCrypto,
        hmacSha256: (input) => {
          hmacData = input.data;
          return webCrypto.hmacSha256(input);
        },
      })
    );
    const authenticated = await Effect.runPromise(
      authenticate(
        requestWithSession(
          "https://inbox.test/private?userId=attacker-controlled-user"
        ),
        () =>
          Effect.sync(() => {
            validations += 1;
            return validatedSession;
          }),
        cryptoLive
      )
    );

    expect(authenticated).toMatchObject({
      actor,
      principal: { id: userId, type: "user" },
      requestAuth: { validated: validatedSession },
      session: currentSession,
    });
    expect(authenticated.requestAuth.sessionSecretHash).toHaveLength(43);
    expect(hmacData).toBe("secret");
    expect(validations).toBe(1);
  });

  it("rejects a request without a session cookie before validation", async () => {
    let validations = 0;
    const error = await Effect.runPromise(
      authenticate(new Request("https://inbox.test/private"), () => {
        validations += 1;
        return Effect.succeed(validatedSession);
      }).pipe(Effect.flip)
    );

    expect(error).toBeInstanceOf(AuthUnauthenticatedError);
    expect(validations).toBe(0);
  });

  it("maps invalid sessions to a generic unauthenticated error", async () => {
    const error = await Effect.runPromise(
      authenticate(requestWithSession(), () =>
        Effect.fail(new SessionValidateError({ message: "Session expired" }))
      ).pipe(Effect.flip)
    );

    expect(error).toBeInstanceOf(AuthUnauthenticatedError);
    expect(error).toMatchObject({
      code: "unauthenticated",
      message: "Unauthenticated",
    });
  });

  it("keeps session infrastructure failures internal", async () => {
    const error = await Effect.runPromise(
      authenticate(requestWithSession(), () =>
        Effect.fail(
          new SessionValidateError({
            cause: new Error("D1 unavailable"),
            message: "Failed to load session",
          })
        )
      ).pipe(Effect.flip)
    );

    expect(error).toBeInstanceOf(AuthInternalError);
    expect(error).toMatchObject({
      code: "internal_error",
      message: "Failed to validate session",
    });
    expect(error).not.toHaveProperty("cause");
  });

  it("returns a typed internal error for a malformed validated token", async () => {
    const malformed = {
      ...validatedSession,
      issued: { ...validatedSession.issued, token: SessionToken("malformed") },
    };
    const error = await Effect.runPromise(
      authenticate(requestWithSession(), () => Effect.succeed(malformed)).pipe(
        Effect.flip
      )
    );

    expect(error).toBeInstanceOf(AuthInternalError);
    expect(error).toMatchObject({
      code: "internal_error",
      message: "Failed to bind validated session",
    });
  });

  it("maps HMAC failures to a typed internal error", async () => {
    const webCrypto = makeWebCrypto();
    const cryptoLive = Layer.succeed(
      Crypto,
      Crypto.of({
        ...webCrypto,
        hmacSha256: () =>
          Effect.fail(
            new CryptoError({
              message: "HMAC unavailable",
              operation: "hmac-sha256",
            })
          ),
      })
    );
    const error = await Effect.runPromise(
      authenticate(
        requestWithSession(),
        () => Effect.succeed(validatedSession),
        cryptoLive
      ).pipe(Effect.flip)
    );

    expect(error).toBeInstanceOf(AuthInternalError);
    expect(error).toMatchObject({
      code: "internal_error",
      message: "Failed to bind validated session",
    });
  });
});
