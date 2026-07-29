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
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi";
import { describe, expect, it } from "vitest";

import { ExternalRecoveryIdentityGroup } from "#/modules/account-security/adapters/http/ExternalRecoveryIdentityHttpApi";
import { ExternalRecoveryIdentityHttpHandlersLayer } from "#/modules/account-security/adapters/http/ExternalRecoveryIdentityHttpHandlers";
import {
  CurrentRequestAuthMiddlewareLayer,
  RequestSessionAuthenticatorEffectAuthLayer,
} from "#/modules/account-security/adapters/http/RequestSessionAuthentication";
import type { ExternalRecoveryIdentityManagementShape } from "#/modules/account-security/application/ExternalRecoveryIdentityManagement";
import {
  ExternalRecoveryIdentityManagement,
  ExternalRecoveryIdentityManagementError,
  ExternalRecoveryIdentityOperationReceiptSchema,
} from "#/modules/account-security/application/ExternalRecoveryIdentityManagement";
import { ExternalRecoveryIdentitySchema } from "#/modules/account-security/domain/ExternalRecoveryIdentity";
import { HttpApiPlatformLayer } from "#/platform/cloudflare/HttpApiPlatform";
import {
  backendRequestContext,
  CurrentBackendRequestContext,
} from "#/platform/observability/BackendRequestContext";
import { BackendRequestContextMiddlewareLayer } from "#/platform/observability/BackendRequestContextMiddlewareLayer";

const publicOrigin = "https://inbox.test";
const TestApi = HttpApi.make("AuthApi").add(ExternalRecoveryIdentityGroup);
const userId = UserId("user-a");
const sessionId = SessionId("session-a");
const sessionToken = SessionToken(`${sessionId}.secret`);
const operationId = "00000000-0000-4000-8000-000000000031";
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
const identity = Schema.decodeUnknownSync(ExternalRecoveryIdentitySchema)({
  createdAt: 1000,
  email: {
    address: "person@external.test",
    comparisonKey: "person@external.test",
    normalizedAddress: "person@external.test",
  },
  id: "recovery-a",
  state: { _tag: "Pending", challengeExpiresAt: 2000 },
  updatedAt: 1000,
  userId,
  version: 1,
});
const receipt = Schema.decodeUnknownSync(
  ExternalRecoveryIdentityOperationReceiptSchema
)({
  actorUserId: userId,
  committedAt: 1000,
  identityId: "recovery-a",
  operationId,
  operationKind: "enroll",
  result: identity,
  schemaVersion: 1,
});

const makeManagement = (
  overrides: Partial<ExternalRecoveryIdentityManagementShape> = {}
) =>
  ExternalRecoveryIdentityManagement.of({
    enroll: () => Effect.succeed(identity),
    readOperation: () => Effect.succeed(receipt),
    verify: () => Effect.succeed(identity),
    ...overrides,
  });

const makeHandler = (management: ExternalRecoveryIdentityManagementShape) => {
  const requestAuthLive = Layer.mergeAll(
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
        RequestSessionAuthenticatorEffectAuthLayer.pipe(
          Layer.provide(requestAuthLive)
        )
      )
    )
  );
  const groupLive = ExternalRecoveryIdentityHttpHandlersLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ExternalRecoveryIdentityManagement, management),
        requestAuthLive,
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

const request = (path: string, method: "GET" | "POST", body?: unknown) =>
  new Request(`https://backend.test${path}`, {
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    headers: {
      "content-type": "application/json",
      cookie: `__Host-session=${sessionToken}`,
      origin: publicOrigin,
    },
    method,
  });

describe("external recovery identity API", () => {
  it("serves authenticated actor-scoped receipt readback with no-store headers", async () => {
    const queries: unknown[] = [];
    const { dispose, handler } = makeHandler(
      makeManagement({
        readOperation: (query) => {
          queries.push(query);
          return Effect.succeed(receipt);
        },
      })
    );

    try {
      const response = await handler(
        request(
          `/auth/external-recovery-identity/operations/${operationId}`,
          "GET"
        )
      );

      const body = await response.json();
      expect({
        body,
        cacheControl: response.headers.get("cache-control"),
        exposesDigest:
          typeof body === "object" &&
          body !== null &&
          "verificationSecretHash" in body,
        pragma: response.headers.get("pragma"),
        status: response.status,
      }).toMatchObject({
        body: {
          actorUserId: "user-a",
          operationId,
          operationKind: "enroll",
          result: { email: { address: "person@external.test" } },
        },
        cacheControl: "private, no-store",
        exposesDigest: false,
        pragma: "no-cache",
        status: 200,
      });
      expect(queries).toStrictEqual([{ operationId }]);
    } finally {
      await dispose();
    }
  });

  it("maps operation conflicts without exposing causes or receipt data", async () => {
    const { dispose, handler } = makeHandler(
      makeManagement({
        enroll: () =>
          Effect.fail(
            new ExternalRecoveryIdentityManagementError({
              cause: new Error("person@external.test secret internals"),
              operation: "enroll",
              reason: "operation-conflict",
            })
          ),
      })
    );

    try {
      const response = await handler(
        request("/auth/external-recovery-identity/enroll", "POST", {
          address: "other@external.test",
          operationId,
        })
      );
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body).toStrictEqual({
        _tag: "AuthConflictError",
        code: "conflict",
        message: "External recovery operation ID conflict",
      });
      expect(JSON.stringify(body)).not.toContain("person@external.test");
    } finally {
      await dispose();
    }
  });

  it("maps recovery-policy storage failures to a sanitized internal error", async () => {
    const { dispose, handler } = makeHandler(
      makeManagement({
        enroll: () =>
          Effect.fail(
            new ExternalRecoveryIdentityManagementError({
              cause: new Error("private managed-domain storage detail"),
              operation: "enroll",
              reason: "storage",
            })
          ),
      })
    );
    try {
      const response = await handler(
        request("/auth/external-recovery-identity/enroll", "POST", {
          address: "person@external.test",
          operationId,
        })
      );
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toStrictEqual({
        _tag: "AuthInternalError",
        code: "internal_error",
        message: "External recovery identity operation failed",
      });
      expect(JSON.stringify(body)).not.toContain("managed-domain");
    } finally {
      await dispose();
    }
  });
});
