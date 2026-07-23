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

import { RecoveryCodeManagementGroup } from "#/modules/account-security/adapters/http/RecoveryCodeManagementHttpApi";
import { RecoveryCodeManagementHttpHandlersLayer } from "#/modules/account-security/adapters/http/RecoveryCodeManagementHttpHandlers";
import {
  CurrentRequestAuthMiddlewareLayer,
  RequestSessionAuthenticatorEffectAuthLayer,
} from "#/modules/account-security/adapters/http/RequestSessionAuthentication";
import {
  RecoveryCodeAdministration,
  RecoveryCodeAdministrationError,
  RecoveryCodesAlreadyGenerated,
  RecoveryCodesGenerated,
  RecoveryCodeRotationReceiptSchema,
} from "#/modules/account-security/application/RecoveryCodeAdministration";
import type { RecoveryCodeAdministrationService } from "#/modules/account-security/application/RecoveryCodeAdministration";
import { HttpApiPlatformLayer } from "#/platform/cloudflare/HttpApiPlatform";
import {
  backendRequestContext,
  CurrentBackendRequestContext,
} from "#/platform/observability/BackendRequestContext";
import { BackendRequestContextMiddlewareLayer } from "#/platform/observability/BackendRequestContextMiddlewareLayer";

const publicOrigin = "https://inbox.test";
const TestApi = HttpApi.make("AuthApi").add(RecoveryCodeManagementGroup);
const userId = UserId("user-a");
const sessionId = SessionId("session-a");
const sessionToken = SessionToken(`${sessionId}.secret`);
const operationId = "00000000-0000-4000-8000-000000000041";
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
const receipt = Schema.decodeUnknownSync(RecoveryCodeRotationReceiptSchema)({
  codeCount: 10,
  committedAt: 2000,
  generatedAt: 2000,
  operationId,
  schemaVersion: 1,
  setId: "00000000-0000-4000-8000-000000000051",
  userId,
});
const codes = [..."23456789AB"].map((symbol) => `AAAA-AAAA-AAAA-AAA${symbol}`);

const makeAdministration = (
  overrides: Partial<RecoveryCodeAdministrationService> = {}
) =>
  RecoveryCodeAdministration.of({
    generate: () =>
      Effect.succeed(
        RecoveryCodesGenerated.make({
          _tag: "RecoveryCodesGenerated",
          codes,
          receipt,
        })
      ),
    readOperation: () => Effect.succeed(receipt),
    ...overrides,
  });

const makeHandler = (administration: RecoveryCodeAdministrationService) => {
  const requestAuthLive = Layer.mergeAll(
    Layer.succeed(SessionCookie, makeSessionCookie()),
    Layer.succeed(
      Sessions,
      Sessions.of({
        validate: () => Effect.succeed(validatedSession),
      } as unknown as SessionsService)
    ),
    WebCryptoLive(),
    AuthSecretsLive({
      challenge: Redacted.make("challenge-secret"),
      privacy: Redacted.make("privacy-secret"),
      session: Redacted.make("session-secret"),
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
      allowMissingOrigin: false,
      allowedOrigins: [publicOrigin],
    }),
    CurrentRequestAuthMiddlewareLayer.pipe(
      Layer.provide(
        RequestSessionAuthenticatorEffectAuthLayer.pipe(
          Layer.provide(requestAuthLive)
        )
      )
    )
  );
  const groupLive = RecoveryCodeManagementHttpHandlersLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(RecoveryCodeAdministration, administration),
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

describe("recovery-code management API", () => {
  it("returns codes only for first success and a receipt-only tag for replay", async () => {
    let calls = 0;
    const { dispose, handler } = makeHandler(
      makeAdministration({
        generate: () => {
          calls += 1;
          return Effect.succeed(
            calls === 1
              ? RecoveryCodesGenerated.make({
                  _tag: "RecoveryCodesGenerated",
                  codes,
                  receipt,
                })
              : RecoveryCodesAlreadyGenerated.make({
                  _tag: "RecoveryCodesAlreadyGenerated",
                  receipt,
                })
          );
        },
      })
    );

    try {
      const first = await handler(
        request("/auth/recovery-codes/generate", "POST", { operationId })
      );
      const replay = await handler(
        request("/auth/recovery-codes/generate", "POST", { operationId })
      );
      const firstBody = (await first.json()) as { readonly receipt: unknown };
      const replayBody = await replay.json();

      expect(firstBody).toMatchObject({
        _tag: "RecoveryCodesGenerated",
        codes,
        receipt: { operationId },
      });
      expect(replayBody).toStrictEqual({
        _tag: "RecoveryCodesAlreadyGenerated",
        receipt: firstBody.receipt,
      });
      expect(JSON.stringify(replayBody)).not.toContain("AAAA-AAAA");
      expect(first.headers.get("cache-control")).toBe("private, no-store");
      expect(replay.headers.get("cache-control")).toBe("private, no-store");
    } finally {
      await dispose();
    }
  });

  it("serves authenticated receipt readback with no-store headers and no codes", async () => {
    const queries: unknown[] = [];
    const { dispose, handler } = makeHandler(
      makeAdministration({
        readOperation: (query) => {
          queries.push(query);
          return Effect.succeed(receipt);
        },
      })
    );

    try {
      const response = await handler(
        request(`/auth/recovery-codes/operations/${operationId}`, "GET")
      );
      const body = await response.json();

      expect({
        cacheControl: response.headers.get("cache-control"),
        pragma: response.headers.get("pragma"),
        status: response.status,
      }).toStrictEqual({
        cacheControl: "private, no-store",
        pragma: "no-cache",
        status: 200,
      });
      expect(body).toMatchObject({ codeCount: 10, operationId });
      expect(body).not.toHaveProperty("codes");
      expect(queries).toStrictEqual([{ operationId }]);
    } finally {
      await dispose();
    }
  });

  it.each([
    ["operation-conflict", 409, "Recovery-code rotation conflict"],
    [
      "indeterminate",
      500,
      "Recovery-code replacement outcome is unknown. Check the operation before rotating again.",
    ],
  ] as const)(
    "sanitizes %s failures without exposing causes or receipt data",
    async (reason, status, message) => {
      const { dispose, handler } = makeHandler(
        makeAdministration({
          generate: () =>
            Effect.fail(
              new RecoveryCodeAdministrationError({
                cause: new Error("AAAA-AAAA-AAAA-AAAA secret storage cause"),
                operation: "generate",
                reason,
              })
            ),
        })
      );

      try {
        const response = await handler(
          request("/auth/recovery-codes/generate", "POST", { operationId })
        );
        const body = await response.json();

        expect(response.status).toBe(status);
        expect(body).toMatchObject({ message });
        expect(JSON.stringify(body)).not.toContain("AAAA-AAAA");
        expect(JSON.stringify(body)).not.toContain(operationId);
      } finally {
        await dispose();
      }
    }
  );
});
