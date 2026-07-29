import { AuthSecretsLive } from "@effect-auth/core/AuthConfig";
import { WebCryptoLive } from "@effect-auth/core/Crypto";
import {
  AuthOriginCheckMiddlewareLive,
  AuthSchemaErrorMiddlewareLive,
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
} from "@effect-auth/core/Sessions";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiClient,
} from "effect/unstable/httpapi";
import { describe, expect, it } from "vitest";

import { FirstOwnerPasswordEnrollmentGroup } from "#/modules/account-security/adapters/http/FirstOwnerPasswordEnrollmentHttpApi";
import { FirstOwnerPasswordEnrollmentHttpHandlersLayer } from "#/modules/account-security/adapters/http/FirstOwnerPasswordEnrollmentHttpHandlers";
import {
  CurrentRequestAuthMiddlewareLayer,
  RequestSessionAuthenticatorEffectAuthLayer,
} from "#/modules/account-security/adapters/http/RequestSessionAuthentication";
import {
  EnrollFirstOwnerPasswordCommand,
  FirstOwnerPasswordAlreadyEnrolled,
  FirstOwnerPasswordEnrolled,
  FirstOwnerPasswordEnrollment,
  FirstOwnerPasswordEnrollmentError,
  FirstOwnerPasswordEnrollmentReceipt,
} from "#/modules/account-security/application/FirstOwnerPasswordEnrollment";
import type { FirstOwnerPasswordEnrollmentService } from "#/modules/account-security/application/FirstOwnerPasswordEnrollment";
import { HttpApiPlatformLayer } from "#/platform/cloudflare/HttpApiPlatform";
import {
  backendRequestContext,
  CurrentBackendRequestContext,
} from "#/platform/observability/BackendRequestContext";
import { BackendRequestContextMiddlewareLayer } from "#/platform/observability/BackendRequestContextMiddlewareLayer";

const publicOrigin = "https://inbox.test";
const TestApi = HttpApi.make("AuthApi").add(FirstOwnerPasswordEnrollmentGroup);
const userId = UserId("user-a");
const sessionId = SessionId("session-a");
const sessionToken = SessionToken(`${sessionId}.secret`);
const operationId = "00000000-0000-4000-8000-000000000091";
const password = "correct horse battery staple";
const receipt = Schema.decodeUnknownSync(FirstOwnerPasswordEnrollmentReceipt)({
  committedAt: 2000,
  operationId,
  schemaVersion: 1,
});
const validatedSession = {
  actor: { sessionId, userId },
  currentSession: {
    aal: "aal1",
    amr: [],
    authenticationEvents: [],
    authTime: UnixMillis(1000),
    expiresAt: UnixMillis(10_000),
    sessionId,
    userId,
  },
  issued: {
    aal: "aal1",
    amr: [],
    authenticationEvents: [],
    authTime: UnixMillis(1000),
    expiresAt: UnixMillis(10_000),
    sessionId,
    token: sessionToken,
    userId,
  },
} satisfies ValidatedSession;

const makeEnrollment = (
  overrides: Partial<FirstOwnerPasswordEnrollmentService> = {}
) =>
  FirstOwnerPasswordEnrollment.of({
    enroll: () =>
      Effect.succeed(
        FirstOwnerPasswordEnrolled.make({
          _tag: "FirstOwnerPasswordEnrolled",
          receipt,
        })
      ),
    ...overrides,
  });

const makeHandler = (enrollment = makeEnrollment()) => {
  const authLive = Layer.mergeAll(
    Layer.effect(SessionCookie, makeSessionCookie()),
    Layer.succeed(
      Sessions,
      Sessions.of({
        validate: () => Effect.succeed(validatedSession),
      } as unknown as SessionsService)
    ),
    WebCryptoLive(),
    AuthSecretsLive({
      challenge: Redacted.make("challenge-secret".repeat(3)),
      privacy: Redacted.make("privacy-secret".repeat(3)),
      session: Redacted.make("session-secret".repeat(3)),
    })
  );
  const middlewareLive = Layer.mergeAll(
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
    CurrentRequestAuthMiddlewareLayer.pipe(
      Layer.provide(
        RequestSessionAuthenticatorEffectAuthLayer.pipe(Layer.provide(authLive))
      )
    )
  );
  const groupLive = FirstOwnerPasswordEnrollmentHttpHandlersLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(FirstOwnerPasswordEnrollment, enrollment),
        authLive,
        middlewareLive
      )
    )
  );

  return HttpRouter.toWebHandler(
    HttpApiBuilder.layer(TestApi).pipe(
      Layer.provide(Layer.merge(groupLive, middlewareLive)),
      Layer.provide(HttpApiPlatformLayer),
      Layer.provide(NodeServices.layer)
    ),
    { disableLogger: true }
  );
};

const request = (
  body: unknown,
  options: { readonly cookie?: boolean; readonly origin?: string } = {}
) =>
  new Request("https://backend.test/auth/first-owner/password", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...(options.cookie === false
        ? {}
        : { cookie: `__Host-session=${sessionToken}` }),
      ...(options.origin === undefined
        ? { origin: publicOrigin }
        : { origin: options.origin }),
    },
    method: "POST",
  });

const typedClientCall = (
  handler: (request: Request) => Promise<Response>,
  payload: { readonly operationId: string; readonly password: string }
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const httpClient = HttpClient.make((clientRequest) =>
        Effect.gen(function* () {
          const webRequest = yield* HttpClientRequest.toWeb(clientRequest).pipe(
            Effect.orDie
          );
          const headers = new Headers(webRequest.headers);
          headers.set("cookie", `__Host-session=${sessionToken}`);
          headers.set("origin", publicOrigin);
          const response = yield* Effect.promise(() =>
            handler(new Request(webRequest, { headers }))
          );
          return HttpClientResponse.fromWeb(clientRequest, response);
        })
      );
      const client = yield* HttpApiClient.makeWith(TestApi, {
        baseUrl: "https://backend.test",
        httpClient,
      });
      return yield* client.firstOwnerPasswordEnrollment.enroll({
        payload: Schema.decodeUnknownSync(EnrollFirstOwnerPasswordCommand)(
          payload
        ),
      });
    })
  );

describe("first-owner password enrollment API", () => {
  it("accepts both declared success statuses through the generated typed client", async () => {
    let calls = 0;
    const { dispose, handler } = makeHandler(
      makeEnrollment({
        enroll: () => {
          calls += 1;
          return Effect.succeed(
            calls === 1
              ? FirstOwnerPasswordEnrolled.make({
                  _tag: "FirstOwnerPasswordEnrolled",
                  receipt,
                })
              : FirstOwnerPasswordAlreadyEnrolled.make({
                  _tag: "FirstOwnerPasswordAlreadyEnrolled",
                  receipt,
                })
          );
        },
      })
    );

    try {
      const first = await typedClientCall(handler, { operationId, password });
      const replay = await typedClientCall(handler, { operationId, password });
      expect([first._tag, replay._tag]).toStrictEqual([
        "FirstOwnerPasswordEnrolled",
        "FirstOwnerPasswordAlreadyEnrolled",
      ]);
    } finally {
      await dispose();
    }
  });

  it("returns 201 for enrollment and 200 for exact replay without exposing the password", async () => {
    let calls = 0;
    const commands: unknown[] = [];
    const { dispose, handler } = makeHandler(
      makeEnrollment({
        enroll: (command) => {
          calls += 1;
          commands.push(command);
          return Effect.succeed(
            calls === 1
              ? FirstOwnerPasswordEnrolled.make({
                  _tag: "FirstOwnerPasswordEnrolled",
                  receipt,
                })
              : FirstOwnerPasswordAlreadyEnrolled.make({
                  _tag: "FirstOwnerPasswordAlreadyEnrolled",
                  receipt,
                })
          );
        },
      })
    );

    try {
      const first = await handler(request({ operationId, password }));
      const replay = await handler(request({ operationId, password }));
      const firstBody = await first.json();
      const replayBody = await replay.json();

      expect({
        cacheControl: first.headers.get("cache-control"),
        commands,
        pragma: first.headers.get("pragma"),
        statuses: [first.status, replay.status],
      }).toStrictEqual({
        cacheControl: "private, no-store",
        commands: [
          { operationId, password },
          { operationId, password },
        ],
        pragma: "no-cache",
        statuses: [201, 200],
      });
      expect(firstBody).toMatchObject({
        _tag: "FirstOwnerPasswordEnrolled",
        receipt: { operationId },
      });
      expect(replayBody).toMatchObject({
        _tag: "FirstOwnerPasswordAlreadyEnrolled",
        receipt: { operationId },
      });
      expect(JSON.stringify([firstBody, replayBody])).not.toContain(password);
    } finally {
      await dispose();
    }
  });

  it.each([
    ["invalid-input", 400, "bad_request"],
    ["owner-not-eligible", 403, "policy_denied"],
    ["operation-conflict", 409, "conflict"],
    ["rate-limited", 429, "rate_limited"],
    ["storage", 500, "internal_error"],
  ] as const)("maps %s to a sanitized %s", async (reason, status, code) => {
    const { dispose, handler } = makeHandler(
      makeEnrollment({
        enroll: () =>
          Effect.fail(
            new FirstOwnerPasswordEnrollmentError({
              cause: new Error(`sensitive ${password}`),
              reason,
            })
          ),
      })
    );

    try {
      const response = await handler(request({ operationId, password }));
      const text = await response.text();
      expect(response.status).toBe(status);
      expect(JSON.parse(text)).toMatchObject({ code });
      expect(text).not.toContain(password);
      expect(text).not.toContain("sensitive");
    } finally {
      await dispose();
    }
  });

  it("rejects unauthenticated, cross-origin, and extra-input requests before enrollment", async () => {
    let calls = 0;
    const { dispose, handler } = makeHandler(
      makeEnrollment({
        enroll: () => {
          calls += 1;
          return Effect.succeed(
            FirstOwnerPasswordEnrolled.make({
              _tag: "FirstOwnerPasswordEnrolled",
              receipt,
            })
          );
        },
      })
    );

    try {
      const unauthenticated = await handler(
        request({ operationId, password }, { cookie: false })
      );
      const crossOrigin = await handler(
        request({ operationId, password }, { origin: "https://evil.test" })
      );
      const extraInput = await handler(
        request({ email: "owner@example.test", operationId, password })
      );
      expect(unauthenticated.status).toBe(401);
      expect(crossOrigin.status).toBe(403);
      expect(extraInput.status).toBe(400);
      expect(calls).toBe(0);
    } finally {
      await dispose();
    }
  });
});
