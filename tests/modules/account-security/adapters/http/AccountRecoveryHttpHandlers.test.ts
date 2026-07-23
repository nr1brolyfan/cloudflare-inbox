/* oxlint-disable vitest/max-expects -- HTTP contract tests assert cookie, cache, privacy, and rate behavior together. */
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
import type { IssuedSession } from "@effect-auth/core/Sessions";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi";
import { describe, expect, it } from "vitest";

import { AccountRecoveryGroup } from "#/modules/account-security/adapters/http/AccountRecoveryHttpApi";
import { AccountRecoveryHttpHandlersLayer } from "#/modules/account-security/adapters/http/AccountRecoveryHttpHandlers";
import { AccountRecovery } from "#/modules/account-security/application/AccountRecovery";
import type { AccountRecoveryService } from "#/modules/account-security/application/AccountRecovery";
import {
  accountRecoveryAccepted,
  AccountRecoveryCompletionReceipt,
  AccountRecoveryError,
} from "#/modules/account-security/domain/AccountRecovery";
import { HttpApiPlatformLayer } from "#/platform/cloudflare/HttpApiPlatform";
import {
  backendRequestContext,
  CurrentBackendRequestContext,
} from "#/platform/observability/BackendRequestContext";
import { BackendRequestContextMiddlewareLayer } from "#/platform/observability/BackendRequestContextMiddlewareLayer";

const publicOrigin = "https://inbox.test";
const TestApi = HttpApi.make("AuthApi").add(AccountRecoveryGroup);
const operationId = "00000000-0000-4000-8000-000000000061";
const readbackSecret = "r".repeat(43);
const receipt = Schema.decodeUnknownSync(AccountRecoveryCompletionReceipt)({
  completedAt: 2000,
  operationId,
  schemaVersion: 1,
  status: "recovery-remediation-required",
});
const session = {
  aal: "aal1",
  amr: ["external_recovery_link", "recovery_code"],
  authenticationEvents: [],
  authTime: UnixMillis(2000),
  claims: {
    recoveryRemediation: { allowed: ["second-passkey"] },
    requirements: ["recovery_remediation"],
  },
  expiresAt: UnixMillis(902_000),
  sessionId: SessionId("restricted-session-a"),
  token: SessionToken("restricted-session-a.secret"),
  userId: UserId("user-a"),
} satisfies IssuedSession;

const makeRecovery = (overrides: Partial<AccountRecoveryService> = {}) =>
  AccountRecovery.of({
    complete: () =>
      Effect.succeed({
        _tag: "AccountRecoveryCompleted" as const,
        receipt,
        session,
      }),
    readCompletion: () => Effect.succeed(receipt),
    start: () => Effect.succeed(accountRecoveryAccepted),
    ...overrides,
  });

const makeHandler = (options: {
  readonly onCommit?: () => void;
  readonly onRateLimit?: (input: unknown) => void;
  readonly recovery?: AccountRecoveryService;
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
      allowMissingOrigin: false,
      allowedOrigins: [publicOrigin],
    }),
    AuthRequestMetadataMiddlewareLive({ trustProxyHeaders: true })
  );
  const groupLayer = AccountRecoveryHttpHandlersLayer.pipe(
    Layer.provide(
      Layer.succeed(AccountRecovery, options.recovery ?? makeRecovery())
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
            return yield* HttpServerResponse.json(
              { type: "authenticated" },
              {
                headers: {
                  "set-cookie":
                    "__Host-session=restricted-session-a.secret; HttpOnly; Secure; SameSite=Lax; Path=/",
                },
              }
            ).pipe(Effect.orDie);
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
      "user-agent": "account-recovery-http-test-agent",
      "x-forwarded-for": "203.0.113.30",
    },
    method: "POST",
  });

const completeBody = {
  code: "AAAA-BBBB-CCCC-DDDD",
  flowId: "account-recovery-flow-a",
  operationId,
  readbackSecret,
  secret: "s".repeat(32),
};

describe("account recovery completion API", () => {
  it("sets the restricted cookie only for the first completion response", async () => {
    let calls = 0;
    let commits = 0;
    const rateLimits: unknown[] = [];
    const { dispose, handler } = makeHandler({
      onCommit: () => {
        commits += 1;
      },
      onRateLimit: (input) => rateLimits.push(input),
      recovery: makeRecovery({
        complete: () => {
          calls += 1;
          return Effect.succeed(
            calls === 1
              ? {
                  _tag: "AccountRecoveryCompleted" as const,
                  receipt,
                  session,
                }
              : {
                  _tag: "AccountRecoveryAlreadyCompleted" as const,
                  receipt,
                }
          );
        },
      }),
    });

    try {
      const first = await handler(
        request("/auth/account-recovery/complete", completeBody)
      );
      const replay = await handler(
        request("/auth/account-recovery/complete", completeBody)
      );
      const firstBody = await first.json();
      const replayBody = await replay.json();

      expect(firstBody).toStrictEqual({ ...receipt });
      expect(replayBody).toStrictEqual({ ...receipt });
      expect(first.headers.get("set-cookie")).toContain("HttpOnly");
      expect(replay.headers.get("set-cookie")).toBeNull();
      expect(first.headers.get("cache-control")).toBe("private, no-store");
      expect(replay.headers.get("cache-control")).toBe("private, no-store");
      expect(commits).toBe(1);
      expect(rateLimits).toMatchObject([
        { operation: "auth.recovery_code.verify" },
        { operation: "auth.recovery_code.verify" },
      ]);
    } finally {
      await dispose();
    }
  });

  it("serves proof-bound POST readback without bearer material or a cookie", async () => {
    const payloads: unknown[] = [];
    const rateLimits: unknown[] = [];
    const { dispose, handler } = makeHandler({
      onRateLimit: (input) => rateLimits.push(input),
      recovery: makeRecovery({
        readCompletion: (payload) => {
          payloads.push(payload);
          return Effect.succeed(receipt);
        },
      }),
    });

    try {
      const response = await handler(
        request("/auth/account-recovery/completion/read", {
          operationId,
          readbackSecret,
        })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("pragma")).toBe("no-cache");
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(body).toStrictEqual({ ...receipt });
      expect(body).not.toHaveProperty("sessionId");
      expect(body).not.toHaveProperty("userId");
      expect(payloads).toStrictEqual([{ operationId, readbackSecret }]);
      expect(rateLimits).toMatchObject([
        { operation: "auth.recovery_code.verify" },
      ]);
    } finally {
      await dispose();
    }
  });

  it.each(["invalid-input", "invalid-proof"] as const)(
    "maps %s readback denial to the same generic response",
    async (reason) => {
      const { dispose, handler } = makeHandler({
        recovery: makeRecovery({
          readCompletion: () =>
            Effect.fail(
              new AccountRecoveryError({
                cause: new Error("sensitive account detail"),
                operation: "read-completion",
                reason,
              })
            ),
        }),
      });

      try {
        const response = await handler(
          request("/auth/account-recovery/completion/read", {
            operationId,
            readbackSecret,
          })
        );
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body).toStrictEqual({
          _tag: "AuthBadRequestError",
          code: "bad_request",
          message: "Invalid account recovery request",
        });
        expect(JSON.stringify(body)).not.toContain("sensitive account detail");
      } finally {
        await dispose();
      }
    }
  );

  it("gives missing and mismatched readback proof the same generic denial", async () => {
    const { dispose, handler } = makeHandler({
      recovery: makeRecovery({
        readCompletion: () =>
          Effect.fail(
            new AccountRecoveryError({
              operation: "read-completion",
              reason: "invalid-proof",
            })
          ),
      }),
    });

    try {
      const mismatched = await handler(
        request("/auth/account-recovery/completion/read", {
          operationId,
          readbackSecret,
        })
      );
      const missing = await handler(
        request("/auth/account-recovery/completion/read", { operationId })
      );
      const mismatchedBody = await mismatched.json();
      const missingBody = await missing.json();

      expect(missing.status).toBe(mismatched.status);
      expect(missingBody).toStrictEqual(mismatchedBody);
    } finally {
      await dispose();
    }
  });

  it("rejects cross-origin readback before the service", async () => {
    let reads = 0;
    const { dispose, handler } = makeHandler({
      recovery: makeRecovery({
        readCompletion: () => {
          reads += 1;
          return Effect.succeed(receipt);
        },
      }),
    });

    try {
      const response = await handler(
        request(
          "/auth/account-recovery/completion/read",
          { operationId, readbackSecret },
          "https://attacker.test"
        )
      );

      expect(response.status).toBe(403);
      expect(reads).toBe(0);
    } finally {
      await dispose();
    }
  });
});
