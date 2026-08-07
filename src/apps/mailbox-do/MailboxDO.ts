import type { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { MailboxSocketAttachment } from "#/modules/mailbox/adapters/durable-object/MailboxChangePublisherDo";
import type { MailboxDoStub } from "#/modules/mailbox/adapters/durable-object/MailboxDoClient";
import { MailboxDoHandler } from "#/modules/mailbox/adapters/durable-object/MailboxDoHandler";
import { MailboxDirectoryStore } from "#/modules/mailbox/adapters/sqlite/MailboxDirectoryStoreSqlite";
import { MailboxResourceIndex } from "#/modules/mailbox/adapters/sqlite/MailboxResourceIndexSqlite";
import { MailboxDatabase } from "#/modules/mailbox/adapters/sqlite/MailboxSqliteDatabase";
import { mailboxSchemaVersion } from "#/modules/mailbox/adapters/sqlite/MailboxSqliteMigrations";
import { mailboxSchemaMigration } from "#/modules/mailbox/adapters/sqlite/MailboxSqliteSchema";
import {
  directoryResponseChangeScopes,
  mailDataResponseChangeScopes,
} from "#/modules/mailbox/application/MailboxChangeProjection";
import { MailboxOutboundAlarmDispatch } from "#/modules/mailbox/application/MailboxOutboundAlarmDispatch";
import { MailboxOutboundAlarmScheduler } from "#/modules/mailbox/application/MailboxOutboundAlarmScheduler";
import {
  MailboxChangedEvent,
  mailboxRealtimeLeaseMillis,
} from "#/modules/mailbox/domain/MailboxRealtime";
import { MailboxChangePublisher } from "#/modules/mailbox/ports/MailboxChangePublisher";
import {
  DirectoryRpcResponse,
  MailDataRpcResponse,
} from "#/modules/mailbox/ports/MailboxDoProtocol";
import { MailboxOutboundLifecycleStore } from "#/modules/mailbox/ports/MailboxOutboundLifecycleStore";
import { mailboxOperationalStatusD1Layer } from "#/modules/organization/adapters/d1/MailboxOperationalStatusD1";
import {
  ControlPlaneDatabase,
  MailboxEmailSender,
  RawMessagesBucket,
} from "#/platform/cloudflare/Resources";

import { MailboxDoApplicationLayer } from "./MailboxDoApplicationLayer";
import {
  MailboxDoBindings,
  mailboxDoBindingsFromClients,
} from "./MailboxDoBindings";

const mailboxDoImplementation = Effect.gen(function* () {
  const database = yield* MailboxDatabase;
  const directoryStore = yield* MailboxDirectoryStore;
  const resourceIndex = yield* MailboxResourceIndex;
  const handler = yield* MailboxDoHandler;
  const outboundAlarm = yield* MailboxOutboundAlarmScheduler;
  const outboundAlarmDispatch = yield* MailboxOutboundAlarmDispatch;
  const outboundLifecycle = yield* MailboxOutboundLifecycleStore;
  const changePublisher = yield* MailboxChangePublisher;

  yield* resourceIndex.initialize;
  yield* directoryStore.initialize;
  const recoveredDeliveries = yield* outboundLifecycle.recoverStaleSending;
  if (recoveredDeliveries > 0) {
    yield* changePublisher.publish(["messages", "navigation", "outbound"]);
  }
  yield* outboundAlarm.reconcile;

  const publishDirectoryResponse = (response: unknown) =>
    Schema.decodeUnknownEffect(DirectoryRpcResponse)(response).pipe(
      Effect.flatMap((decoded) => {
        const scopes = directoryResponseChangeScopes(decoded);
        return scopes.length === 0
          ? Effect.void
          : changePublisher.publish(scopes);
      }),
      Effect.orDie
    );
  const publishMailDataResponse = (response: unknown) =>
    Schema.decodeUnknownEffect(MailDataRpcResponse)(response).pipe(
      Effect.flatMap((decoded) => {
        const scopes = mailDataResponseChangeScopes(decoded);
        return scopes.length === 0
          ? Effect.void
          : changePublisher.publish(scopes);
      }),
      Effect.orDie
    );

  return {
    executeDirectory: (input: unknown) =>
      handler
        .executeDirectory(input)
        .pipe(Effect.tap(publishDirectoryResponse), Effect.orDie),
    executeMailData: (input: unknown) =>
      handler
        .executeMailData(input)
        .pipe(Effect.tap(publishMailDataResponse), Effect.orDie),
    resolveMailResource: handler.resolveMailResource,
    publishChanges: (input: unknown) =>
      Schema.decodeUnknownEffect(MailboxChangedEvent)(input).pipe(
        Effect.flatMap((event) => changePublisher.publish(event.scopes)),
        Effect.orDie
      ),
    fetch: Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (
        request.method !== "GET" ||
        request.headers.upgrade?.toLowerCase() !== "websocket"
      ) {
        return HttpServerResponse.text("WebSocket upgrade required", {
          status: 426,
        });
      }
      const requestedLease = Number(
        request.headers["x-mailbox-lease-expires-at"]
      );
      const now = Date.now();
      if (!Number.isSafeInteger(requestedLease) || requestedLease <= now) {
        return HttpServerResponse.text("Invalid WebSocket lease", {
          status: 400,
        });
      }
      const leaseExpiresAt = Math.min(
        requestedLease,
        now + mailboxRealtimeLeaseMillis
      );
      const attachment = yield* Schema.decodeUnknownEffect(
        MailboxSocketAttachment
      )({ formatVersion: 1, leaseExpiresAt }).pipe(Effect.orDie);
      const [response, socket] = yield* Cloudflare.upgrade();
      socket.serializeAttachment(attachment);
      return response;
    }),
    webSocketMessage: (socket: Cloudflare.WebSocket) =>
      socket.close(1008, "Client messages are not supported"),
    webSocketClose: (
      socket: Cloudflare.WebSocket,
      code: number,
      reason: string
    ) => socket.close(code, reason),
    alarm: () =>
      outboundAlarmDispatch.handle.pipe(
        Effect.ensuring(
          changePublisher.publish(["messages", "navigation", "outbound"])
        )
      ),
    sqliteReady: () =>
      Effect.gen(function* () {
        const [row] = yield* database
          .select({
            version: sql<number>`coalesce(max(${mailboxSchemaMigration.version}), 0)`,
          })
          .from(mailboxSchemaMigration);

        if (row?.version !== mailboxSchemaVersion) {
          return yield* Effect.die(
            new Error("MailboxDO SQLite schema is not current")
          );
        }

        return true;
      }).pipe(Effect.orDie),
  };
});

const mailboxDoRuntime = Effect.gen(function* () {
  const controlPlane = yield* Cloudflare.D1.QueryDatabase(ControlPlaneDatabase);
  const rawMessages = yield* Cloudflare.R2.ReadWriteBucket(RawMessagesBucket);
  const isDevelopment = process.env.ALCHEMY_DEV === "true";
  const email = isDevelopment
    ? undefined
    : yield* Cloudflare.Email.Send(MailboxEmailSender);

  return Effect.gen(function* () {
    const providerDisabled =
      process.env.MAILBOX_OUTBOUND_PROVIDER_DISABLED === "true";
    const bindings = mailboxDoBindingsFromClients(
      controlPlane,
      rawMessages,
      providerDisabled ? undefined : email
    );
    const controlPlaneDatabase = yield* bindings.controlPlane;
    const operationalStatusLayer =
      mailboxOperationalStatusD1Layer(controlPlaneDatabase);

    return yield* mailboxDoImplementation.pipe(
      Effect.provide(
        MailboxDoApplicationLayer.pipe(
          Layer.provide(operationalStatusLayer),
          Layer.provide(Layer.succeed(MailboxDoBindings, bindings))
        )
      ),
      Effect.orDie
    );
  }).pipe(Effect.orDie);
}).pipe(
  Effect.provide(Cloudflare.D1.QueryDatabaseBinding),
  Effect.provide(Cloudflare.Email.SendBinding),
  Effect.provide(Cloudflare.R2.ReadWriteBucketBinding),
  Effect.orDie
);

/** SQLite-backed data-plane object with migrations completed before RPC starts. */
export class MailboxDO extends Cloudflare.DurableObject<MailboxDO>()(
  "MailboxDO",
  mailboxDoRuntime
) {}

export interface MailboxDOStub extends MailboxDoStub {
  readonly sqliteReady: () => Effect.Effect<unknown, unknown, RuntimeContext>;
  readonly publishChanges: (
    input: Schema.Codec.Encoded<typeof MailboxChangedEvent>
  ) => Effect.Effect<void, unknown, RuntimeContext>;
}

export interface MailboxDONamespace {
  readonly getByName: (name: string) => MailboxDOStub;
}
