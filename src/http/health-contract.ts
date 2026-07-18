import * as Schema from "effect/Schema";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";

const CheckStatus = Schema.Literals(["ok", "error"]);

export const StorageHealthSchema = Schema.Struct({
  authRateLimit: CheckStatus,
  authorization: CheckStatus,
  controlPlane: CheckStatus,
  rawMessages: CheckStatus,
});

export type StorageHealth = Schema.Schema.Type<typeof StorageHealthSchema>;

const HealthOk = Schema.Struct({
  service: Schema.Literal("backend"),
  status: Schema.Literal("ok"),
  storage: StorageHealthSchema,
});

const HealthDegraded = Schema.Struct({
  service: Schema.Literal("backend"),
  status: Schema.Literal("degraded"),
  storage: StorageHealthSchema,
}).pipe(HttpApiSchema.status(503));

export type BackendHealthReport =
  | Schema.Schema.Type<typeof HealthOk>
  | Schema.Schema.Type<typeof HealthDegraded>;

export const HealthEndpoint = HttpApiEndpoint.get("get", "/api/health", {
  success: [HealthOk, HealthDegraded],
});

export class HealthGroup extends HttpApiGroup.make("health").add(
  HealthEndpoint
) {}
