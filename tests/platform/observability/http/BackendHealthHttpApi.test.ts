import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi";
import { describe, expect, it } from "vitest";

import { HttpApiPlatformLayer } from "#/platform/cloudflare/HttpApiPlatform";
import * as Health from "#/platform/observability/BackendHealth";
import { BackendHealthGroup } from "#/platform/observability/http/BackendHealthHttpApi";
import { BackendHealthHttpHandlersLayer } from "#/platform/observability/http/BackendHealthHttpHandlers";

const HealthTestApi = HttpApi.make("AuthApi").add(BackendHealthGroup);
const healthyReport: Health.BackendHealthReport = {
  service: "backend",
  status: "ok",
  storage: {
    authRateLimit: "ok",
    authorization: "ok",
    controlPlane: "ok",
    mailboxDataPlane: "ok",
    rawMessages: "ok",
  },
};

const makeHealthHandler = (report: Health.BackendHealthReport) =>
  HttpRouter.toWebHandler(
    HttpApiBuilder.layer(HealthTestApi).pipe(
      Layer.provide(BackendHealthHttpHandlersLayer),
      Layer.provide(
        Layer.succeed(
          Health.BackendHealth,
          Health.BackendHealth.of({ check: Effect.succeed(report) })
        )
      ),
      Layer.provide(HttpApiPlatformLayer),
      Layer.provide(NodeServices.layer)
    ),
    { disableLogger: true }
  );

describe("backend health API", () => {
  it("returns a schema-encoded healthy response", async () => {
    const { dispose, handler } = makeHealthHandler(healthyReport);

    try {
      const response = await handler(
        new Request("https://backend.test/api/health")
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({
        service: "backend",
        status: "ok",
        storage: {
          authRateLimit: "ok",
          authorization: "ok",
          controlPlane: "ok",
          mailboxDataPlane: "ok",
          rawMessages: "ok",
        },
      });
    } finally {
      await dispose();
    }
  });

  it("uses the degraded response schema when a check fails", async () => {
    const { dispose, handler } = makeHealthHandler({
      service: "backend",
      status: "degraded",
      storage: {
        ...healthyReport.storage,
        rawMessages: "error",
      },
    });

    try {
      const response = await handler(
        new Request("https://backend.test/api/health")
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toStrictEqual({
        service: "backend",
        status: "degraded",
        storage: {
          authRateLimit: "ok",
          authorization: "ok",
          controlPlane: "ok",
          mailboxDataPlane: "ok",
          rawMessages: "error",
        },
      });
    } finally {
      await dispose();
    }
  });

  it("lets the shared router produce declarative not-found responses", async () => {
    const { dispose, handler } = makeHealthHandler(healthyReport);

    try {
      const [unknownRoute, wrongMethod] = await Promise.all([
        handler(new Request("https://backend.test/missing")),
        handler(
          new Request("https://backend.test/api/health", { method: "POST" })
        ),
      ]);

      expect([unknownRoute.status, wrongMethod.status]).toStrictEqual([
        404, 404,
      ]);
    } finally {
      await dispose();
    }
  });
});
