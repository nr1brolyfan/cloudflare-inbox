import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";

export interface StorageHealth {
  readonly authRateLimit: "ok" | "error";
  readonly authorization: "ok" | "error";
  readonly controlPlane: "ok" | "error";
  readonly rawMessages: "ok" | "error";
}

export type BackendHealthReport =
  | {
      readonly service: "backend";
      readonly status: "ok";
      readonly storage: StorageHealth;
    }
  | {
      readonly service: "backend";
      readonly status: "degraded";
      readonly storage: StorageHealth;
    };

export interface BackendHealth {
  readonly check: Effect.Effect<BackendHealthReport>;
}

export const BackendHealth = Context.Service<BackendHealth>(
  "cloudflare-inbox/BackendHealth"
);

const CheckStatus = Schema.Literals(["ok", "error"]);
const StorageStatus = Schema.Struct({
  authRateLimit: CheckStatus,
  authorization: CheckStatus,
  controlPlane: CheckStatus,
  rawMessages: CheckStatus,
});
const HealthOk = Schema.Struct({
  service: Schema.Literal("backend"),
  status: Schema.Literal("ok"),
  storage: StorageStatus,
});
const HealthDegraded = Schema.Struct({
  service: Schema.Literal("backend"),
  status: Schema.Literal("degraded"),
  storage: StorageStatus,
}).pipe(HttpApiSchema.status(503));

export const HealthEndpoint = HttpApiEndpoint.get("get", "/api/health", {
  success: [HealthOk, HealthDegraded],
});

export class HealthGroup extends HttpApiGroup.make("health").add(
  HealthEndpoint
) {}

export const BackendHttpApi = HttpApi.make("BackendHttpApi").add(HealthGroup);

const HealthGroupLive = HttpApiBuilder.group(
  BackendHttpApi,
  "health",
  Effect.fn("backend.http.health_group")(function* (handlers) {
    const health = yield* BackendHealth;

    return handlers.handle("get", () => health.check);
  })
);

export const HealthHttpLive = HttpApiBuilder.layer(BackendHttpApi).pipe(
  Layer.provide(HealthGroupLive)
);
