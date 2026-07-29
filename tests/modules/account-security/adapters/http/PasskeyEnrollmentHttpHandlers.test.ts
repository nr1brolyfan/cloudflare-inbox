/* oxlint-disable vitest/max-expects -- HTTP receipt tests assert one-time, cookie, cache, and privacy contracts together. */
import { AuthSecretsLive } from "@effect-auth/core/AuthConfig";
import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import type { AuthRateLimitService } from "@effect-auth/core/AuthRateLimit";
import { WebCryptoLive } from "@effect-auth/core/Crypto";
import {
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
import { RateLimitExceededError } from "@effect-auth/core/RateLimiter";
import type { RateLimitPolicyId } from "@effect-auth/core/RateLimiter";
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
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi";
import { describe, expect, it } from "vitest";

import { PasskeyEnrollmentGroup } from "#/modules/account-security/adapters/http/PasskeyEnrollmentHttpApi";
import {
  PasskeyEnrollmentHttpHandlersLayer,
  RecoveryPasskeyEnrollmentHttpHandlersLayer,
  RecoveryPasskeyEnrollmentReadbackHttpHandlersLayer,
} from "#/modules/account-security/adapters/http/PasskeyEnrollmentHttpHandlers";
import {
  RecoveryPasskeyEnrollmentGroup,
  RecoveryPasskeyEnrollmentReadbackGroup,
} from "#/modules/account-security/adapters/http/RecoveryPasskeyEnrollmentHttpApi";
import {
  CurrentRequestAuthMiddlewareLayer,
  RecoveryRemediationRequestAuthMiddlewareLayer,
  RequestSessionAuthenticatorEffectAuthLayer,
} from "#/modules/account-security/adapters/http/RequestSessionAuthentication";
import {
  PasskeyEnrollment,
  PasskeyEnrollmentError,
  PasskeyEnrollmentReceiptSchema,
  RecoveryPasskeyRemediationCompleted,
  StartedPasskeyEnrollment,
} from "#/modules/account-security/application/PasskeyEnrollment";
import type { PasskeyEnrollmentShape } from "#/modules/account-security/application/PasskeyEnrollment";
import { HttpApiPlatformLayer } from "#/platform/cloudflare/HttpApiPlatform";
import {
  backendRequestContext,
  CurrentBackendRequestContext,
} from "#/platform/observability/BackendRequestContext";
import { BackendRequestContextMiddlewareLayer } from "#/platform/observability/BackendRequestContextMiddlewareLayer";

const publicOrigin = "https://inbox.test";
const operationId = "00000000-0000-4000-8000-000000000071";
const readbackSecret = "r".repeat(43);
const challengeId = "challenge-a";
const credential = {
  clientExtensionResults: {},
  id: "YnJvd3Nlci1h",
  rawId: "YnJvd3Nlci1h",
  response: {
    attestationObject: "YXR0ZXN0YXRpb24tYQ",
    clientDataJSON:
      "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiWTJoaGJHeGxibWRsIiwib3JpZ2luIjoiaHR0cHM6Ly9pbmJveC50ZXN0In0",
  },
  type: "public-key" as const,
};
const userId = UserId("user-a");
const sessionId = SessionId("session-a");
const sessionToken = SessionToken(`${sessionId}.secret`);
const receipt = Schema.decodeUnknownSync(PasskeyEnrollmentReceiptSchema)({
  committedAt: 2000,
  credentialRecordId: "passkey-record-a",
  mode: "normal",
  operationId,
  schemaVersion: 1,
});
const recoveryReceipt = Schema.decodeUnknownSync(
  PasskeyEnrollmentReceiptSchema
)({
  committedAt: 2000,
  credentialRecordId: "passkey-record-a",
  mode: "recovery-remediation",
  operationId,
  recoveryCodeCount: 10,
  recoveryCodeSetId: "recovery-code-set-a",
  schemaVersion: 1,
});
const codes = [..."23456789AB"].map((symbol) => `AAAA-AAAA-AAAA-AAA${symbol}`);
const issuedSession = {
  aal: "aal2",
  amr: ["passkey"],
  authenticationEvents: [],
  authTime: UnixMillis(2000),
  expiresAt: UnixMillis(Date.now() + 900_000),
  sessionId: SessionId("new-session-a"),
  token: SessionToken("new-session-a.secret"),
  userId,
} as const;

const validatedSession = (
  recoveryAllowed: readonly string[] | null,
  includeRecoveryEnrollment = false
): ValidatedSession => {
  const claims =
    recoveryAllowed === null
      ? undefined
      : {
          ...(includeRecoveryEnrollment
            ? { recoveryEnrollment: { allowed: ["recovery-codes"] } }
            : {}),
          recoveryRemediation: { allowed: [...recoveryAllowed] },
          requirements: ["recovery_remediation"],
        };
  const currentSession = {
    aal: "aal1" as const,
    amr: [],
    authenticationEvents: [],
    authTime: UnixMillis(1000),
    ...(claims === undefined ? {} : { claims }),
    expiresAt: UnixMillis(10_000),
    sessionId,
    userId,
  };
  return {
    actor: { sessionId, userId },
    currentSession,
    issued: { ...currentSession, token: sessionToken },
  } as ValidatedSession;
};

const makeEnrollment = (
  overrides: Partial<PasskeyEnrollmentShape> = {}
): PasskeyEnrollmentShape =>
  PasskeyEnrollment.of({
    finish: () => Effect.succeed({ receipt, replayed: false }),
    readOperation: () => Effect.succeed(receipt),
    readRecoveryOperation: () => Effect.succeed(recoveryReceipt),
    start: () =>
      Effect.succeed(
        Schema.decodeUnknownSync(StartedPasskeyEnrollment)({
          challengeId: "challenge-a",
          expiresAt: 3000,
          operationId,
          publicKey: {
            challenge: "challenge",
            pubKeyCredParams: [],
            rp: { id: "inbox.test", name: "Inbox" },
            user: { displayName: "User", id: "user-a", name: "User" },
          },
        })
      ),
    ...overrides,
  });

const requestAuthLayers = (
  recoveryAllowed: readonly string[] | null,
  includeRecoveryEnrollment = false
) => {
  const authLive = Layer.mergeAll(
    Layer.effect(SessionCookie, makeSessionCookie()),
    Layer.succeed(
      Sessions,
      Sessions.of({
        validate: () =>
          Effect.succeed(
            validatedSession(recoveryAllowed, includeRecoveryEnrollment)
          ),
      } as unknown as SessionsService)
    ),
    WebCryptoLive(),
    AuthSecretsLive({
      challenge: Redacted.make("challenge-secret".repeat(3)),
      privacy: Redacted.make("privacy-secret".repeat(3)),
      session: Redacted.make("session-secret".repeat(3)),
    })
  );
  return {
    authLive,
    current: CurrentRequestAuthMiddlewareLayer.pipe(
      Layer.provide(
        RequestSessionAuthenticatorEffectAuthLayer.pipe(Layer.provide(authLive))
      )
    ),
    recovery: RecoveryRemediationRequestAuthMiddlewareLayer.pipe(
      Layer.provide(
        RequestSessionAuthenticatorEffectAuthLayer.pipe(Layer.provide(authLive))
      )
    ),
  };
};

const commonMiddleware = Layer.mergeAll(
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

const makeHandler = (
  kind: "normal" | "readback" | "recovery",
  enrollment: PasskeyEnrollmentShape,
  rateLimit: AuthRateLimitService = AuthRateLimit.of({
    require: () => Effect.void,
  }),
  recoveryAllowed: readonly string[] | null = ["second-passkey"],
  includeRecoveryEnrollment = false
) => {
  const auth = requestAuthLayers(
    kind === "recovery" ? recoveryAllowed : null,
    includeRecoveryEnrollment
  );
  if (kind === "normal") {
    const api = HttpApi.make("AuthApi").add(PasskeyEnrollmentGroup);
    const groupLive = PasskeyEnrollmentHttpHandlersLayer.pipe(
      Layer.provide(auth.current),
      Layer.provide(Layer.succeed(PasskeyEnrollment, enrollment)),
      Layer.provide(auth.authLive),
      Layer.provide(commonMiddleware)
    );
    return HttpRouter.toWebHandler(
      HttpApiBuilder.layer(api).pipe(
        Layer.provide(Layer.merge(groupLive, commonMiddleware)),
        Layer.provide(HttpApiPlatformLayer),
        Layer.provide(NodeServices.layer)
      ),
      { disableLogger: true }
    );
  }
  if (kind === "recovery") {
    const api = HttpApi.make("AuthApi").add(RecoveryPasskeyEnrollmentGroup);
    const groupLive = RecoveryPasskeyEnrollmentHttpHandlersLayer.pipe(
      Layer.provide(auth.recovery),
      Layer.provide(Layer.succeed(PasskeyEnrollment, enrollment)),
      Layer.provide(auth.authLive),
      Layer.provide(commonMiddleware)
    );
    return HttpRouter.toWebHandler(
      HttpApiBuilder.layer(api).pipe(
        Layer.provide(Layer.merge(groupLive, commonMiddleware)),
        Layer.provide(HttpApiPlatformLayer),
        Layer.provide(NodeServices.layer)
      ),
      { disableLogger: true }
    );
  }
  const api = HttpApi.make("AuthApi").add(
    RecoveryPasskeyEnrollmentReadbackGroup
  );
  const groupLive = RecoveryPasskeyEnrollmentReadbackHttpHandlersLayer.pipe(
    Layer.provide(Layer.succeed(PasskeyEnrollment, enrollment)),
    Layer.provide(Layer.succeed(AuthRateLimit, rateLimit)),
    Layer.provide(auth.authLive),
    Layer.provide(commonMiddleware)
  );
  return HttpRouter.toWebHandler(
    HttpApiBuilder.layer(api).pipe(
      Layer.provide(Layer.merge(groupLive, commonMiddleware)),
      Layer.provide(HttpApiPlatformLayer),
      Layer.provide(NodeServices.layer)
    ),
    { disableLogger: true }
  );
};

const request = (path: string, method: "GET" | "POST", body?: unknown) =>
  new Request(`https://backend.test${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      "content-type": "application/json",
      cookie: `__Host-session=${sessionToken}`,
      origin: publicOrigin,
      "x-forwarded-for": "203.0.113.40",
    },
    method,
  });

describe("passkey enrollment receipt HTTP contracts", () => {
  it("serves authenticated actor-scoped normal readback with no-store", async () => {
    const queries: unknown[] = [];
    const { dispose, handler } = makeHandler(
      "normal",
      makeEnrollment({
        readOperation: (query) => {
          queries.push(query);
          return Effect.succeed(receipt);
        },
      })
    );
    try {
      const response = await handler(
        request("/auth/passkey/register/read", "POST", {
          challengeId,
          credential,
          operationId,
        })
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
      await expect(response.json()).resolves.toStrictEqual({ ...receipt });
      expect(queries).toStrictEqual([{ challengeId, credential, operationId }]);
    } finally {
      await dispose();
    }
  });

  it("returns a cookie and exactly ten codes only for first recovery success", async () => {
    let calls = 0;
    const completed = Schema.decodeUnknownSync(
      RecoveryPasskeyRemediationCompleted
    )({
      codes,
      receipt: recoveryReceipt,
      type: "recovery-remediation-completed",
    });
    const { dispose, handler } = makeHandler(
      "recovery",
      makeEnrollment({
        finish: () => {
          calls += 1;
          return Effect.succeed(
            calls === 1
              ? {
                  receipt: recoveryReceipt,
                  remediation: { body: completed, session: issuedSession },
                  replayed: false,
                }
              : { receipt: recoveryReceipt, replayed: true }
          );
        },
      })
    );
    const body = {
      challengeId: "challenge-a",
      credential,
      operationId,
      readbackSecret,
    };
    try {
      const first = await handler(
        request("/auth/account-recovery/passkey/enroll/finish", "POST", body)
      );
      const replay = await handler(
        request("/auth/account-recovery/passkey/enroll/finish", "POST", body)
      );
      const firstBody = (await first.json()) as { readonly codes: unknown[] };
      const replayBody = await replay.json();
      expect(firstBody.codes).toHaveLength(10);
      expect(first.headers.get("set-cookie")).toContain("HttpOnly");
      expect(replay.headers.get("set-cookie")).toBeNull();
      expect(first.headers.get("cache-control")).toBe("private, no-store");
      expect(first.headers.get("pragma")).toBe("no-cache");
      expect(replay.headers.get("cache-control")).toBe("private, no-store");
      expect(replay.headers.get("pragma")).toBe("no-cache");
      expect(replayBody).toStrictEqual({
        receipt: { ...recoveryReceipt },
        type: "passkey-enrollment-already-completed",
      });
      expect(JSON.stringify(replayBody)).not.toContain("AAAA-AAAA");
    } finally {
      await dispose();
    }
  });

  it.each([
    ["overbroad", ["second-passkey", "account-settings"], false],
    ["unrelated", ["account-settings"], false],
    ["empty", [], false],
    ["unrestricted", null, false],
    ["second-container", ["second-passkey"], true],
  ] as const)(
    "denies a %s capability session before recovery handler invocation",
    async (_name, allowed, includeRecoveryEnrollment) => {
      let finishes = 0;
      const { dispose, handler } = makeHandler(
        "recovery",
        makeEnrollment({
          finish: () => {
            finishes += 1;
            return Effect.succeed({ receipt: recoveryReceipt, replayed: true });
          },
        }),
        undefined,
        allowed,
        includeRecoveryEnrollment
      );
      try {
        const response = await handler(
          request("/auth/account-recovery/passkey/enroll/finish", "POST", {
            challengeId,
            credential,
            operationId,
            readbackSecret,
          })
        );

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
          code: "policy_denied",
        });
        expect(finishes).toBe(0);
      } finally {
        await dispose();
      }
    }
  );

  it("serves proof-bound recovery readback without cookies or codes", async () => {
    const payloads: unknown[] = [];
    const limits: unknown[] = [];
    const { dispose, handler } = makeHandler(
      "readback",
      makeEnrollment({
        readRecoveryOperation: (payload) => {
          payloads.push(payload);
          return Effect.succeed(recoveryReceipt);
        },
      }),
      AuthRateLimit.of({
        require: (input) =>
          Effect.sync(() => {
            limits.push(input);
          }),
      })
    );
    try {
      const response = await handler(
        request("/auth/account-recovery/passkey/enroll/read", "POST", {
          challengeId,
          credential,
          operationId,
          readbackSecret,
        })
      );
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(body).toStrictEqual({ ...recoveryReceipt });
      expect(body).not.toHaveProperty("codes");
      expect(payloads).toStrictEqual([
        { challengeId, credential, operationId, readbackSecret },
      ]);
      expect(limits).toMatchObject([
        {
          operation: "auth.passkey.registration_finish",
          policy: {
            rules: [{ id: "app.account_recovery.passkey_read.ip" }],
          },
        },
      ]);
    } finally {
      await dispose();
    }
  });

  it.each(["invalid-input", "invalid-proof"] as const)(
    "maps %s public proof denial to one generic response",
    async (reason) => {
      const { dispose, handler } = makeHandler(
        "readback",
        makeEnrollment({
          readRecoveryOperation: () =>
            Effect.fail(
              new PasskeyEnrollmentError({
                operation: "finish",
                reason,
              })
            ),
        })
      );
      try {
        const response = await handler(
          request("/auth/account-recovery/passkey/enroll/read", "POST", {
            challengeId,
            credential,
            operationId,
            readbackSecret,
          })
        );
        expect(response.status).toBe(400);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        await expect(response.json()).resolves.toMatchObject({
          code: "bad_request",
        });
      } finally {
        await dispose();
      }
    }
  );

  it("maps the dedicated public readback rate limit without calling the service", async () => {
    let reads = 0;
    const { dispose, handler } = makeHandler(
      "readback",
      makeEnrollment({
        readRecoveryOperation: () => {
          reads += 1;
          return Effect.succeed(recoveryReceipt);
        },
      }),
      AuthRateLimit.of({
        require: () =>
          Effect.fail(
            new RateLimitExceededError({
              limit: 20,
              policyId:
                "app.account_recovery.passkey_read.ip" as RateLimitPolicyId,
              remaining: 0,
              retryAfter: Duration.seconds(60),
            })
          ),
      })
    );
    try {
      const response = await handler(
        request("/auth/account-recovery/passkey/enroll/read", "POST", {
          challengeId,
          credential,
          operationId,
          readbackSecret,
        })
      );
      const body = await response.json();

      expect(response.status).toBe(429);
      expect(body).toMatchObject({ code: "rate_limited" });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(JSON.stringify(body)).not.toContain("AAAA-AAAA");
      expect(reads).toBe(0);
    } finally {
      await dispose();
    }
  });

  it("gives missing, operation-only, and mismatched proof one generic no-store denial", async () => {
    const { dispose, handler } = makeHandler(
      "readback",
      makeEnrollment({
        readRecoveryOperation: () =>
          Effect.fail(
            new PasskeyEnrollmentError({
              operation: "finish",
              reason: "invalid-proof",
            })
          ),
      })
    );
    try {
      const responses = await Promise.all([
        handler(
          request("/auth/account-recovery/passkey/enroll/read", "POST", {})
        ),
        handler(
          request("/auth/account-recovery/passkey/enroll/read", "POST", {
            operationId,
          })
        ),
        handler(
          request("/auth/account-recovery/passkey/enroll/read", "POST", {
            challengeId,
            credential,
            operationId,
            readbackSecret: "x".repeat(43),
          })
        ),
      ]);
      const bodies = await Promise.all(
        responses.map((response) => response.json())
      );

      expect(responses.map((response) => response.status)).toStrictEqual([
        400, 400, 400,
      ]);
      expect(bodies[1]).toStrictEqual(bodies[0]);
      expect(bodies[2]).toStrictEqual(bodies[0]);
      expect(
        responses.every(
          (response) =>
            response.headers.get("cache-control") === "private, no-store" &&
            response.headers.get("set-cookie") === null
        )
      ).toBeTruthy();
    } finally {
      await dispose();
    }
  });
});
