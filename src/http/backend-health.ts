import {
  PermissionAdministration,
  Permissions,
  PermissionSubject,
} from "@effect-auth/core/Permission";
import type { RuntimeContext } from "alchemy";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { MailPermission, mailboxScope } from "../authorization/catalog";
import { BackendResources } from "./backend-context";
import * as Health from "./health";

const eraseRuntimeContext = <A, E>(
  effect: Effect.Effect<A, E, RuntimeContext>
): Effect.Effect<A, E> => effect as Effect.Effect<A, E>;

export const BackendHealthLive = Layer.effect(
  Health.BackendHealth,
  Effect.gen(function* () {
    const resources = yield* BackendResources;
    const administration = yield* PermissionAdministration;
    const permissions = yield* Permissions;
    const probeAuthorization = Effect.gen(function* () {
      const definition = yield* administration.getPermissionDefinition(
        MailPermission.mailboxRead
      );

      if (Option.isNone(definition)) {
        return yield* Effect.die(
          new Error("Mail permission catalog is not installed")
        );
      }

      yield* permissions.hasPermission({
        permission: MailPermission.mailboxRead,
        scope: mailboxScope("__health__"),
        subject: PermissionSubject.make("health", "backend"),
      });
    });
    // A zero-token request verifies the Durable Object binding without consuming quota.
    const probeAuthRateLimit = eraseRuntimeContext(
      resources.authRateLimit.getByName("health").fixedWindow({
        limit: undefined,
        refillMillis: 1,
        tokens: 0,
      })
    );
    const probeControlPlane = eraseRuntimeContext(
      resources.controlPlane.prepare("select 1 as ready").first()
    );
    const probeRawMessages = eraseRuntimeContext(
      resources.rawMessages.head("__health__")
    );
    const check = Effect.all(
      {
        authRateLimit: probeAuthRateLimit.pipe(Effect.exit),
        authorization: probeAuthorization.pipe(Effect.exit),
        controlPlane: probeControlPlane.pipe(Effect.exit),
        rawMessages: probeRawMessages.pipe(Effect.exit),
      },
      { concurrency: "unbounded" }
    ).pipe(
      Effect.map((results) => {
        const storage: Health.StorageHealth = {
          authRateLimit: Exit.isSuccess(results.authRateLimit) ? "ok" : "error",
          authorization: Exit.isSuccess(results.authorization) ? "ok" : "error",
          controlPlane: Exit.isSuccess(results.controlPlane) ? "ok" : "error",
          rawMessages: Exit.isSuccess(results.rawMessages) ? "ok" : "error",
        };

        return Object.values(storage).every((status) => status === "ok")
          ? ({ service: "backend", status: "ok", storage } as const)
          : ({ service: "backend", status: "degraded", storage } as const);
      })
    );

    return Health.BackendHealth.of({ check });
  })
);
