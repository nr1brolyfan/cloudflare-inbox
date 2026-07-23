import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const CheckStatus = Schema.Literals(["ok", "error"]);

export const StorageHealthSchema = Schema.Struct({
  authRateLimit: CheckStatus,
  authorization: CheckStatus,
  controlPlane: CheckStatus,
  mailboxDataPlane: CheckStatus,
  rawMessages: CheckStatus,
});
export type StorageHealth = Schema.Schema.Type<typeof StorageHealthSchema>;

export const BackendHealthOk = Schema.Struct({
  service: Schema.Literal("backend"),
  status: Schema.Literal("ok"),
  storage: StorageHealthSchema,
});
export const BackendHealthDegraded = Schema.Struct({
  service: Schema.Literal("backend"),
  status: Schema.Literal("degraded"),
  storage: StorageHealthSchema,
});
export type BackendHealthReport =
  | Schema.Schema.Type<typeof BackendHealthOk>
  | Schema.Schema.Type<typeof BackendHealthDegraded>;

export interface BackendHealth {
  readonly check: Effect.Effect<BackendHealthReport>;
}

/** Transport-neutral aggregate readiness probe. */
export const BackendHealth = Context.Service<BackendHealth>(
  "cloudflare-inbox/BackendHealth"
);
