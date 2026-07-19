import type { D1EffectQbDatabaseLike } from "@effect-auth/core/EffectQbSqliteStorage";
import type * as D1Client from "@effect/sql-d1/D1Client";
import type * as DrizzleD1 from "drizzle-orm/effect-d1";
import * as Context from "effect/Context";

import type { relations } from "../auth/schema/index.js";

export interface ControlPlaneD1Binding {
  readonly database: D1EffectQbDatabaseLike;
}

/** Raw D1 is exposed only for Cloudflare's atomic batch primitive. */
export const ControlPlaneD1Binding = Context.Service<ControlPlaneD1Binding>(
  "cloudflare-inbox/ControlPlaneD1Binding"
);

export type ControlPlaneDatabase = DrizzleD1.EffectSQLiteD1Database<
  typeof relations
> & {
  readonly $client: D1Client.D1Client;
};

/** Effect-native Drizzle client for ordinary control-plane queries. */
export const ControlPlaneDatabase = Context.Service<ControlPlaneDatabase>(
  "cloudflare-inbox/ControlPlaneDatabase"
);
