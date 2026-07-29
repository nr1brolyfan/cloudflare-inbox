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

import { PasskeyCredentialManagementGroup } from "#/modules/account-security/adapters/http/PasskeyCredentialManagementHttpApi";
import { PasskeyCredentialManagementHttpHandlersLayer } from "#/modules/account-security/adapters/http/PasskeyCredentialManagementHttpHandlers";
import {
  CurrentRequestAuthMiddlewareLayer,
  RequestSessionAuthenticatorEffectAuthLayer,
} from "#/modules/account-security/adapters/http/RequestSessionAuthentication";
import type { PasskeyCredentialAdministrationShape as AdministrationService } from "#/modules/account-security/application/PasskeyCredentialAdministration";
import {
  PasskeyCredentialAdministration,
  PasskeyCredentialAdministrationError,
  PasskeyCredentialList,
  PasskeyRevocationReceipt,
} from "#/modules/account-security/application/PasskeyCredentialAdministration";
import { HttpApiPlatformLayer } from "#/platform/cloudflare/HttpApiPlatform";
import {
  backendRequestContext,
  CurrentBackendRequestContext,
} from "#/platform/observability/BackendRequestContext";
import { BackendRequestContextMiddlewareLayer } from "#/platform/observability/BackendRequestContextMiddlewareLayer";

const publicOrigin = "https://inbox.test";
const TestApi = HttpApi.make("AuthApi").add(PasskeyCredentialManagementGroup);
const userId = UserId("user-a");
const sessionId = SessionId("session-a");
const sessionToken = SessionToken(`${sessionId}.secret`);
const operationId = "00000000-0000-4000-8000-000000000040";
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
const credentialList = Schema.decodeUnknownSync(PasskeyCredentialList)({
  credentials: [{ createdAt: 1000, id: "passkey-a", lastUsedAt: 2000 }],
});
const receipt = Schema.decodeUnknownSync(PasskeyRevocationReceipt)({
  credential: {
    createdAt: 1000,
    id: "passkey-a",
    lastUsedAt: 2000,
    revokedAt: 3000,
  },
  operationId,
});

const makeAdministration = (
  overrides: Partial<AdministrationService> = {}
): AdministrationService =>
  PasskeyCredentialAdministration.of({
    list: () => Effect.succeed(credentialList),
    readRevocation: () => Effect.succeed(receipt),
    revoke: () => Effect.succeed(receipt),
    ...overrides,
  });

const makeHandler = (administration: AdministrationService) => {
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
  const groupLive = PasskeyCredentialManagementHttpHandlersLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(PasskeyCredentialAdministration, administration),
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

describe("passkey credential management API", () => {
  it("serves privacy-safe list, revoke, and receipt readback contracts", async () => {
    const commands: unknown[] = [];
    const queries: unknown[] = [];
    const { dispose, handler } = makeHandler(
      makeAdministration({
        readRevocation: (query) => {
          queries.push(query);
          return Effect.succeed(receipt);
        },
        revoke: (command) => {
          commands.push(command);
          return Effect.succeed(receipt);
        },
      })
    );

    try {
      const [listed, revoked, readback] = await Promise.all([
        handler(request("/auth/passkey/credentials/list", "POST", {})),
        handler(
          request("/auth/passkey/credentials/revoke", "POST", {
            id: "passkey-a",
            operationId,
          })
        ),
        handler(
          request("/auth/passkey/credentials/revocations/read", "POST", {
            operationId,
          })
        ),
      ]);

      expect([listed.status, revoked.status, readback.status]).toStrictEqual([
        200, 200, 200,
      ]);
      await expect(listed.json()).resolves.toStrictEqual({
        credentials: [{ createdAt: 1000, id: "passkey-a", lastUsedAt: 2000 }],
      });
      await expect(revoked.json()).resolves.toMatchObject({
        credential: { id: "passkey-a", revokedAt: 3000 },
        operationId,
      });
      await expect(readback.json()).resolves.toMatchObject({ operationId });
      expect({ commands, queries }).toMatchObject({
        commands: [{ id: "passkey-a", operationId }],
        queries: [{ operationId }],
      });
    } finally {
      await dispose();
    }
  });

  it("maps last-factor protection to a policy denial", async () => {
    const { dispose, handler } = makeHandler(
      makeAdministration({
        revoke: () =>
          Effect.fail(
            new PasskeyCredentialAdministrationError({
              operation: "revoke",
              reason: "last-factor",
            })
          ),
      })
    );

    try {
      const response = await handler(
        request("/auth/passkey/credentials/revoke", "POST", {
          id: "passkey-a",
          operationId,
        })
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        code: "policy_denied",
      });
    } finally {
      await dispose();
    }
  });

  it("maps a session invalidated during revocation to unauthenticated", async () => {
    const { dispose, handler } = makeHandler(
      makeAdministration({
        revoke: () =>
          Effect.fail(
            new PasskeyCredentialAdministrationError({
              operation: "revoke",
              reason: "unauthenticated",
            })
          ),
      })
    );

    try {
      const response = await handler(
        request("/auth/passkey/credentials/revoke", "POST", {
          id: "passkey-a",
          operationId,
        })
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        code: "unauthenticated",
      });
    } finally {
      await dispose();
    }
  });

  it("rejects credential reads without a browser origin", async () => {
    let calls = 0;
    const { dispose, handler } = makeHandler(
      makeAdministration({
        list: () =>
          Effect.sync(() => {
            calls += 1;
            return credentialList;
          }),
      })
    );

    try {
      const response = await handler(
        new Request("https://backend.test/auth/passkey/credentials/list", {
          body: "{}",
          headers: {
            "content-type": "application/json",
            cookie: `__Host-session=${sessionToken}`,
          },
          method: "POST",
        })
      );

      expect(response.status).toBe(403);
      expect(calls).toBe(0);
    } finally {
      await dispose();
    }
  });
});
