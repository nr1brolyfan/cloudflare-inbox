import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import {
  AuthHttp,
  AuthOriginCheckMiddlewareLive,
  AuthRequestMetadataMiddlewareLive,
  AuthSchemaErrorMiddlewareLive,
} from "@effect-auth/core/HttpApi";
import {
  SessionId,
  SessionToken,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi";
import { describe, expect, it } from "vitest";

import { PasskeyAuthenticationGroup } from "#/modules/account-security/adapters/http/PasskeyAuthenticationHttpApi";
import { PasskeyAuthenticationHttpHandlersLayer } from "#/modules/account-security/adapters/http/PasskeyAuthenticationHttpHandlers";
import {
  PasskeyAuthentication,
  PasskeyAuthenticationError,
  StartedPasskeyAuthentication,
} from "#/modules/account-security/application/PasskeyAuthentication";
import type { PasskeyAuthenticationService } from "#/modules/account-security/application/PasskeyAuthentication";
import { HttpApiPlatformLayer } from "#/platform/cloudflare/HttpApiPlatform";
import {
  backendRequestContext,
  CurrentBackendRequestContext,
} from "#/platform/observability/BackendRequestContext";
import { BackendRequestContextMiddlewareLayer } from "#/platform/observability/BackendRequestContextMiddlewareLayer";

const publicOrigin = "https://inbox.test";
const TestApi = HttpApi.make("AuthApi").add(PasskeyAuthenticationGroup);
const started = Schema.decodeUnknownSync(StartedPasskeyAuthentication)({
  challengeId: "passkey-authentication-challenge-a",
  expiresAt: 10_000,
  publicKey: {
    challenge: "server-challenge",
    rpId: "inbox.test",
    userVerification: "required",
  },
});
const session = {
  aal: "aal2" as const,
  amr: ["passkey"],
  authenticationEvents: [],
  authTime: UnixMillis(1000),
  expiresAt: UnixMillis(10_000),
  sessionId: SessionId("session-a"),
  token: SessionToken("session-a.secret"),
  userId: UserId("user-a"),
};
const credential = {
  clientExtensionResults: {},
  id: "YnJvd3Nlci1jcmVkZW50aWFsLWE",
  rawId: "YnJvd3Nlci1jcmVkZW50aWFsLWE",
  response: {
    authenticatorData: "c2lnbmVkLWF1dGhlbnRpY2F0b3ItZGF0YQ",
    clientDataJSON:
      "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiWTJoaGJHeGxibWRsIiwib3JpZ2luIjoiaHR0cHM6Ly9pbmJveC50ZXN0In0",
    signature: "c2lnbmF0dXJlLWE",
  },
  type: "public-key" as const,
};

const makeHandler = (options: {
  readonly finishSignIn?: PasskeyAuthenticationService["finishSignIn"];
  readonly onFinish?: (command: unknown, context: unknown) => void;
  readonly onCommit?: () => void;
  readonly onRateLimit?: (input: unknown) => void;
  readonly onStart?: (payload: unknown) => void;
}) => {
  const middlewareLayer = Layer.mergeAll(
    BackendRequestContextMiddlewareLayer.pipe(
      Layer.provide(
        Layer.succeed(
          CurrentBackendRequestContext,
          CurrentBackendRequestContext.of(backendRequestContext())
        )
      )
    ),
    AuthSchemaErrorMiddlewareLive,
    AuthOriginCheckMiddlewareLive({
      mode: "secure",
      origins: [publicOrigin],
    }),
    AuthRequestMetadataMiddlewareLive({
      ipSource: { _tag: "XForwardedFor", trustedHops: 1 },
    })
  );
  const groupLayer = PasskeyAuthenticationHttpHandlersLayer.pipe(
    Layer.provide(
      Layer.mock(PasskeyAuthentication, {
        finishSignIn:
          options.finishSignIn ??
          ((command, context) =>
            Effect.sync(() => {
              options.onFinish?.(command, context);
              return session;
            })),
        finishStepUp: () => Effect.die("step-up is not used"),
        startSignIn: (payload) =>
          Effect.sync(() => {
            options.onStart?.(payload);
            return started;
          }),
        startStepUp: () => Effect.die("step-up is not used"),
        stepUpAvailable: Effect.succeed(false),
      })
    ),
    Layer.provide(
      Layer.succeed(
        AuthRateLimit,
        AuthRateLimit.of({
          require: (input) =>
            Effect.sync(() => {
              options.onRateLimit?.(input);
            }),
        })
      )
    ),
    Layer.provide(
      Layer.mock(AuthHttp, {
        commitAuthenticatedSession: () =>
          Effect.gen(function* () {
            options.onCommit?.();
            return yield* HttpServerResponse.json({
              aal: "aal2",
              amr: ["passkey"],
              expiresAt: 10_000,
              type: "authenticated",
            }).pipe(Effect.orDie);
          }),
      })
    ),
    Layer.provide(middlewareLayer)
  );

  return HttpRouter.toWebHandler(
    HttpApiBuilder.layer(TestApi).pipe(
      Layer.provide(Layer.merge(groupLayer, middlewareLayer)),
      Layer.provide(HttpApiPlatformLayer),
      Layer.provide(NodeServices.layer)
    ),
    { disableLogger: true }
  );
};

const request = (path: string, body: unknown, origin = publicOrigin) =>
  new Request(`https://backend.test${path}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin,
      "user-agent": "passkey-http-test-agent",
      "x-forwarded-for": "203.0.113.20",
    },
    method: "POST",
  });

describe("passkey authentication API", () => {
  it("ignores caller-selected identity and metadata during discoverable start", async () => {
    const payloads: unknown[] = [];
    const rateLimits: unknown[] = [];
    const { dispose, handler } = makeHandler({
      onRateLimit: (input) => rateLimits.push(input),
      onStart: (payload) => payloads.push(payload),
    });

    try {
      const response = await handler(
        request("/auth/passkey/authenticate/start", {
          metadata: { purpose: "attacker-selected" },
          userId: "user-b",
        })
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        publicKey: {
          rpId: "inbox.test",
          userVerification: "required",
        },
      });
      expect(payloads).toStrictEqual([{}]);
      expect(rateLimits).toMatchObject([
        { operation: "auth.passkey.authentication_start" },
      ]);
    } finally {
      await dispose();
    }
  });

  it("commits a successful passkey session without exposing its token", async () => {
    let commits = 0;
    const finishes: unknown[] = [];
    const { dispose, handler } = makeHandler({
      onCommit: () => {
        commits += 1;
      },
      onFinish: (command, context) => finishes.push({ command, context }),
    });

    try {
      const response = await handler(
        request("/auth/passkey/authenticate/finish", {
          challengeId: started.challengeId,
          credential,
        })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({ aal: "aal2", type: "authenticated" });
      expect(JSON.stringify(body)).not.toContain("session-a.secret");
      expect(commits).toBe(1);
      expect(finishes).toMatchObject([
        {
          context: {
            ip: "203.0.113.20",
            userAgent: "passkey-http-test-agent",
          },
        },
      ]);
    } finally {
      await dispose();
    }
  });

  it("maps credential failures without disclosing account state", async () => {
    const { dispose, handler } = makeHandler({
      finishSignIn: () =>
        Effect.fail(
          new PasskeyAuthenticationError({
            operation: "finish-sign-in",
            reason: "invalid-credential",
          })
        ),
    });

    try {
      const response = await handler(
        request("/auth/passkey/authenticate/finish", {
          challengeId: started.challengeId,
          credential: {
            ...credential,
            id: "dW5rbm93bi1jcmVkZW50aWFs",
            rawId: "dW5rbm93bi1jcmVkZW50aWFs",
          },
        })
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: "bad_request",
      });
    } finally {
      await dispose();
    }
  });

  it("rejects missing and cross-origin browser requests before the service", async () => {
    let starts = 0;
    const { dispose, handler } = makeHandler({
      onStart: () => {
        starts += 1;
      },
    });

    try {
      const [missing, crossOrigin] = await Promise.all([
        handler(
          new Request("https://backend.test/auth/passkey/authenticate/start", {
            body: "{}",
            headers: { "content-type": "application/json" },
            method: "POST",
          })
        ),
        handler(
          request(
            "/auth/passkey/authenticate/start",
            {},
            "https://attacker.test"
          )
        ),
      ]);

      expect([missing.status, crossOrigin.status]).toStrictEqual([403, 403]);
      expect(starts).toBe(0);
    } finally {
      await dispose();
    }
  });
});
