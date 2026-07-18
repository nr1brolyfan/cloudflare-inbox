import type { D1EffectQbDatabaseLike } from "@effect-auth/core/EffectQbSqliteStorage";
import {
  makeD1EffectQbSqliteExecutor,
  makeEffectQbSqlitePermissionStore,
} from "@effect-auth/core/EffectQbSqliteStorage";
import {
  PermissionAdministrationLive,
  PermissionsFromStoreLive,
  PermissionStore,
} from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** D1 database that owns the effect-auth permission catalog and grants. */
export const MailPermissionDatabase = Context.Service<D1EffectQbDatabaseLike>(
  "cloudflare-inbox/MailPermissionDatabase"
);

/** Permission administration and checks backed by the shared control-plane D1. */
export const MailPermissionsLive = Layer.unwrap(
  Effect.gen(function* () {
    const database = yield* MailPermissionDatabase;
    const storeLive = Layer.succeed(
      PermissionStore,
      makeEffectQbSqlitePermissionStore(makeD1EffectQbSqliteExecutor(database))
    );

    return Layer.merge(
      PermissionAdministrationLive.pipe(Layer.provide(storeLive)),
      PermissionsFromStoreLive.pipe(Layer.provide(storeLive))
    );
  })
);
