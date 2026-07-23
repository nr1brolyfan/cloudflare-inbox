import type { AlchemyRateLimitDurableObjectNamespace } from "@effect-auth/core/AlchemyCloudflareRateLimitDurableObject";
import {
  PermissionAdministration,
  Permissions,
  PermissionSubject,
} from "@effect-auth/core/Permission";
import { RuntimeContext } from "alchemy";
import type * as Cloudflare from "alchemy/Cloudflare";
import { sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  MailboxResourceLookup,
  MailboxResourceLookupResult,
} from "#/modules/mailbox/domain/MailboxResource";

import { MailPermission, mailboxScope } from "../authorization/catalog";
import { ControlPlaneDatabase } from "../control-plane/database";
import type { MailboxDoStub } from "../mailboxes/do-client";
import {
  DirectoryRpcRequest,
  DirectoryRpcResponse,
  MailDataRpcRequest,
  MailDataRpcResponse,
} from "../mailboxes/do-protocol";
import { BackendHealth } from "./health";
import type { StorageHealth } from "./health";

type RawMessagesClient = Effect.Success<
  ReturnType<typeof Cloudflare.R2.ReadWriteBucket>
>;

interface MailboxHealthStub extends MailboxDoStub {
  readonly sqliteReady: () => Effect.Effect<unknown, unknown, RuntimeContext>;
}

interface MailboxHealthNamespace {
  readonly getByName: (name: string) => MailboxHealthStub;
}

export interface BackendHealthBindingsShape {
  readonly authRateLimit: AlchemyRateLimitDurableObjectNamespace;
  readonly mailboxDataPlane: MailboxHealthNamespace;
  readonly rawMessages: RawMessagesClient;
}

/** Cloudflare bindings used only by concrete readiness probes. */
export const BackendHealthBindings =
  Context.Service<BackendHealthBindingsShape>(
    "cloudflare-inbox/BackendHealthBindings"
  );

/** Probes every persistent binding used by request handling. */
export const BackendHealthLive = Layer.effect(
  BackendHealth,
  Effect.gen(function* () {
    const bindings = yield* BackendHealthBindings;
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
    const probeAuthRateLimit = bindings.authRateLimit
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
    const healthMailbox = bindings.mailboxDataPlane.getByName("__health__");
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
    const probeRawMessages = bindings.rawMessages
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
        const storage: StorageHealth = {
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

    return BackendHealth.of({ check });
  })
);
