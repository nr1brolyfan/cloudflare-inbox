import {
  PermissionAdministration,
  Permissions,
  PermissionSubject,
} from "@effect-auth/core/Permission";
import { RuntimeContext } from "alchemy";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { MailPermission, mailboxScope } from "../authorization/catalog";
import { ControlPlaneDatabase } from "../control-plane/database";
import type { MailboxDoStub } from "../mailboxes/do-client";
import {
  DirectoryRpcRequest,
  DirectoryRpcResponse,
  MailDataRpcRequest,
  MailDataRpcResponse,
} from "../mailboxes/do-protocol";
import {
  MailboxResourceLookup,
  MailboxResourceLookupResult,
} from "../mailboxes/repository";
import { BackendResources } from "./backend-context";
import * as Health from "./health";

interface MailboxHealthStub extends MailboxDoStub {
  readonly sqliteReady: () => Effect.Effect<unknown, unknown, RuntimeContext>;
}

interface MailboxHealthNamespace {
  readonly getByName: (name: string) => MailboxHealthStub;
}

/** Probes every persistent binding used by request handling. */
export const BackendHealthLive = Layer.effect(
  Health.BackendHealth,
  Effect.gen(function* () {
    const resources = yield* BackendResources;
    const controlPlane = yield* ControlPlaneDatabase;
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
    const probeAuthRateLimit = resources.authRateLimit
      .getByName("health")
      .fixedWindow({
        limit: undefined,
        refillMillis: 1,
        tokens: 0,
      })
      .pipe(Effect.provide(RuntimeContext.phantom));
    const probeControlPlane = controlPlane.get<{ readonly ready: number }>(
      sql`select 1 as ready`
    );
    const mailboxNamespace: MailboxHealthNamespace = resources.mailboxDataPlane;
    const healthMailbox = mailboxNamespace.getByName("__health__");
    const probeMailboxDataPlane = Effect.gen(function* () {
      const directoryRequest = yield* Schema.decodeUnknownEffect(
        DirectoryRpcRequest
      )({ _tag: "ListFolders", input: { mailboxId: "__health__" } });
      const mailDataRequest = yield* Schema.decodeUnknownEffect(
        MailDataRpcRequest
      )({ _tag: "ListMessages", input: { mailboxId: "__health__" } });
      const resourceLookup = yield* Schema.decodeUnknownEffect(
        MailboxResourceLookup
      )({
        _tag: "Folder",
        mailboxId: "__health__",
        folderId: "__health__",
      });
      const encodedDirectoryRequest =
        yield* Schema.encodeEffect(DirectoryRpcRequest)(directoryRequest);
      const encodedMailDataRequest =
        yield* Schema.encodeEffect(MailDataRpcRequest)(mailDataRequest);
      const encodedResourceLookup = yield* Schema.encodeEffect(
        MailboxResourceLookup
      )(resourceLookup);

      return yield* Effect.all({
        ready: healthMailbox.sqliteReady(),
        folders: healthMailbox
          .executeDirectory(encodedDirectoryRequest)
          .pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(DirectoryRpcResponse))
          ),
        messages: healthMailbox
          .executeMailData(encodedMailDataRequest)
          .pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(MailDataRpcResponse))
          ),
        missing: healthMailbox
          .resolveMailResource(encodedResourceLookup)
          .pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(MailboxResourceLookupResult)
            )
          ),
      });
    }).pipe(
      Effect.tap(({ folders, messages, missing }) => {
        if (missing._tag !== "NotFound") {
          return Effect.die(
            new Error("MailboxDO repository probe found test data")
          );
        }
        return folders._tag === "FoldersListed" &&
          folders.value.items.length === 7 &&
          messages._tag === "MessagesListed" &&
          messages.value.items.length === 0
          ? Effect.void
          : Effect.die(
              new Error("MailboxDO system folders are not initialized")
            );
      }),
      Effect.provide(RuntimeContext.phantom)
    );
    const probeRawMessages = resources.rawMessages
      .head("__health__")
      .pipe(Effect.provide(RuntimeContext.phantom));
    const check = Effect.all(
      {
        authRateLimit: probeAuthRateLimit.pipe(Effect.exit),
        authorization: probeAuthorization.pipe(Effect.exit),
        controlPlane: probeControlPlane.pipe(Effect.exit),
        mailboxDataPlane: probeMailboxDataPlane.pipe(Effect.exit),
        rawMessages: probeRawMessages.pipe(Effect.exit),
      },
      { concurrency: "unbounded" }
    ).pipe(
      Effect.map((results) => {
        const storage: Health.StorageHealth = {
          authRateLimit: Exit.isSuccess(results.authRateLimit) ? "ok" : "error",
          authorization: Exit.isSuccess(results.authorization) ? "ok" : "error",
          controlPlane: Exit.isSuccess(results.controlPlane) ? "ok" : "error",
          mailboxDataPlane: Exit.isSuccess(results.mailboxDataPlane)
            ? "ok"
            : "error",
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
