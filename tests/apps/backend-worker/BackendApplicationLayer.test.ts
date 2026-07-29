import { DatabaseSync } from "node:sqlite";

import type { AlchemyRateLimitDurableObjectNamespace } from "@effect-auth/core/AlchemyCloudflareRateLimitDurableObject";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  deferredExecutionContext,
  WorkerExecutionContext,
} from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BackendApplicationLayer } from "#/apps/backend-worker/BackendApplicationLayer";
import { BackendHealthBindings } from "#/apps/backend-worker/BackendHealthLayer";
import {
  AuthRuntimeConfig,
  AuthRuntimeConfigSchema,
} from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";
import { DevEmailConfig } from "#/modules/account-security/adapters/http/DevEmailHttpHandlers";
import { AiInferenceUnavailableLayer } from "#/modules/ai/layers/AiInferenceLayer";
import { MailboxDoNamespace } from "#/modules/mailbox/adapters/durable-object/MailboxDoClient";
import { OutboundEmailProviderUnavailableLayer } from "#/modules/mailbox/adapters/email/OutboundEmailProviderUnavailable";
import { DraftAttachmentR2Client } from "#/modules/mailbox/adapters/r2/DraftAttachmentBlobStoreR2";
import { InboundAttachmentR2ReadClient } from "#/modules/mailbox/adapters/r2/InboundAttachmentBlobReaderR2";
import { OutboundDraftAttachmentR2ReadClient } from "#/modules/mailbox/adapters/r2/OutboundDraftAttachmentBlobReaderR2";
import { InboundWorkflowClient } from "#/modules/mailbox/adapters/workflow/InboundWorkflowStarterCloudflare";
import {
  MailboxArchiveConfig,
  parseMailboxArchiveConfig,
} from "#/modules/mailbox/contracts/MailboxArchiveConfig";
import {
  MailboxBootstrapConfig,
  parseMailboxBootstrapConfig,
} from "#/modules/organization/contracts/MailboxBootstrapConfig";
import { ControlPlaneD1Binding } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import {
  backendRequestContext,
  CurrentBackendRequestContext,
} from "#/platform/observability/BackendRequestContext";

import {
  applyControlPlaneMigrations,
  makeTestD1Database,
} from "../../support/d1";

const publicOrigin = "https://mail.test";
const unused = () => Effect.die("binding is not used by auth smoke requests");
const rateLimitNamespace = {
  getByName: () => ({
    fixedWindow: () => Effect.succeed([1, 60_000] as const),
    tokenBucket: () => Effect.succeed(1),
  }),
} as unknown as AlchemyRateLimitDurableObjectNamespace;

let database: DatabaseSync;
let dispose: (() => Promise<void>) | undefined;
let handler: ((request: Request) => Promise<Response>) | undefined;

describe("complete Backend application auth graph", () => {
  beforeAll(async () => {
    database = new DatabaseSync(":memory:");
    await applyControlPlaneMigrations(database);
    const [archiveConfig, bootstrapConfig] = await Promise.all([
      Effect.runPromise(
        parseMailboxArchiveConfig("archive@external.test", "mail.test")
      ),
      Effect.runPromise(
        parseMailboxBootstrapConfig(
          JSON.stringify(["owner@external.test"]),
          "inbox@mail.test"
        )
      ),
    ]);
    const authConfig = Schema.decodeUnknownSync(AuthRuntimeConfigSchema)({
      delivery: { _tag: "development" },
      emailFrom: "auth@mail.test",
      publicOrigin,
      rateLimitNamespace,
      secrets: {
        challenge: Redacted.make("BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA"),
        privacy: Redacted.make("CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCA"),
        session: Redacted.make("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
      },
    });
    const doStub = {
      executeDirectory: unused,
      executeMailData: unused,
      resolveMailResource: unused,
      sqliteReady: unused,
    };
    const bindings = Layer.mergeAll(
      Layer.succeed(AuthRuntimeConfig, authConfig),
      Layer.succeed(
        ControlPlaneD1Binding,
        ControlPlaneD1Binding.of({
          database: makeTestD1Database(database) as unknown as D1Database,
        })
      ),
      Layer.succeed(
        CurrentBackendRequestContext,
        backendRequestContext("0123456789abcdef-SJC")
      ),
      Layer.succeed(MailboxArchiveConfig, archiveConfig),
      Layer.succeed(MailboxBootstrapConfig, bootstrapConfig),
      Layer.succeed(DevEmailConfig, { isDevelopment: true }),
      Layer.succeed(WorkerExecutionContext, deferredExecutionContext),
      Layer.succeed(InboundWorkflowClient, { create: unused, get: unused }),
      Layer.succeed(InboundAttachmentR2ReadClient, { get: unused }),
      Layer.succeed(DraftAttachmentR2Client, { head: unused, put: unused }),
      Layer.succeed(OutboundDraftAttachmentR2ReadClient, { get: unused }),
      Layer.succeed(MailboxDoNamespace, {
        getByName: () => doStub,
      }),
      Layer.succeed(BackendHealthBindings, {
        authRateLimit: rateLimitNamespace,
        mailboxDataPlane: { getByName: () => doStub },
        rawMessages: { head: unused },
      } as never),
      OutboundEmailProviderUnavailableLayer,
      AiInferenceUnavailableLayer,
      NodeServices.layer
    );
    const webHandler = HttpRouter.toWebHandler(
      BackendApplicationLayer.pipe(Layer.provide(bindings)),
      { disableLogger: true }
    );
    const { dispose: disposeHandler, handler: requestHandler } = webHandler;
    dispose = disposeHandler;
    handler = requestHandler;
  });

  afterAll(async () => {
    await dispose?.();
    database.close();
  });

  const request = (path: string, init?: RequestInit) => {
    if (handler === undefined) {
      throw new Error("Backend application handler was not built");
    }
    return handler(new Request(`https://backend.test${path}`, init));
  };

  it("serves GET /auth/session through the complete graph", async () => {
    const response = await request("/auth/session");

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toStrictEqual({
      _tag: "AuthUnauthenticatedError",
      code: "unauthenticated",
      message: "Unauthenticated",
    });
  });

  it("serves POST /auth/magic-link/start and enforces the configured origin", async () => {
    const validBody = JSON.stringify({
      identity: {
        scope: { type: "global" },
        kind: "email",
        value: "owner@external.test",
      },
    });
    const rejected = await request("/auth/magic-link/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://foreign.test",
      },
      body: validBody,
    });
    const accepted = await request("/auth/magic-link/start", {
      method: "POST",
      headers: { "content-type": "application/json", origin: publicOrigin },
      body: JSON.stringify({ identity: { kind: "email" } }),
    });

    expect(rejected.status).toBe(403);
    expect(accepted.status).toBe(400);
    expect(accepted.headers.get("set-cookie")).toBeNull();
    await expect(accepted.json()).resolves.toStrictEqual({
      _tag: "AuthBadRequestError",
      code: "bad_request",
      issues: [
        {
          code: "required",
          message: "Required",
          path: ["identity", "scope"],
        },
      ],
      message: "Invalid request",
    });
  });

  it("serves POST /auth/magic-link/verify with schema errors on the wire", async () => {
    const response = await request("/auth/magic-link/verify", {
      method: "POST",
      headers: { "content-type": "application/json", origin: publicOrigin },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toStrictEqual({
      _tag: "AuthBadRequestError",
      code: "bad_request",
      issues: [
        {
          code: "required",
          message: "Required",
          path: ["challengeId"],
        },
      ],
      message: "Invalid request",
    });
  });

  it("serves GET /auth/step-up/options before reading unavailable factors", async () => {
    const response = await request("/auth/step-up/options");

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toStrictEqual({
      _tag: "AuthUnauthenticatedError",
      code: "unauthenticated",
      message: "Unauthenticated",
    });
  });
});
