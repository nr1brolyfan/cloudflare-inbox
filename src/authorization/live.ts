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
import * as Layer from "effect/Layer";

export const makeMailAuthorizationLive = (database: D1EffectQbDatabaseLike) => {
  const storeLive = Layer.succeed(
    PermissionStore,
    makeEffectQbSqlitePermissionStore(makeD1EffectQbSqliteExecutor(database))
  );

  return Layer.merge(
    PermissionAdministrationLive.pipe(Layer.provide(storeLive)),
    PermissionsFromStoreLive.pipe(Layer.provide(storeLive))
  );
};
