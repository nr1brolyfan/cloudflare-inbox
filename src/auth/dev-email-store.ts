import { DevEmailStore, DevEmailStoreError } from "@effect-auth/core/DevEmail";
import type {
  DevEmailListOptions,
  DevEmailMessage,
  DevEmailStoreOperation,
} from "@effect-auth/core/DevEmail";
import { and, desc, eq, notInArray } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ControlPlaneBatch } from "../control-plane/batch";
import { ControlPlaneDatabase } from "../control-plane/database";
import { appDevEmailMessage } from "../control-plane/schema";

const storeError = (
  operation: DevEmailStoreOperation,
  cause: unknown
): DevEmailStoreError =>
  new DevEmailStoreError({
    operation,
    message: `Failed to ${operation} development email`,
    cause,
  });

const storeOperation = <A, E>(
  operation: DevEmailStoreOperation,
  effect: Effect.Effect<A, E>
): Effect.Effect<A, DevEmailStoreError> =>
  effect.pipe(Effect.mapError((cause) => storeError(operation, cause)));

const decodeMessage = (
  messageJson: string
): Effect.Effect<DevEmailMessage, DevEmailStoreError> =>
  Effect.try({
    try: () => JSON.parse(messageJson) as DevEmailMessage,
    catch: (cause) => storeError("list", cause),
  });

/** App-owned development mailbox backed by the shared Effect Drizzle client. */
export const D1DevEmailStoreLive = Layer.effect(
  DevEmailStore,
  Effect.gen(function* () {
    const database = yield* ControlPlaneDatabase;
    const batch = yield* ControlPlaneBatch;

    return DevEmailStore.of({
      save: (message) =>
        Effect.gen(function* () {
          const messageJson = yield* Effect.try({
            try: () => JSON.stringify(message),
            catch: (cause) => storeError("save", cause),
          });
          const upsert = database
            .insert(appDevEmailMessage)
            .values({
              id: message.id,
              kind: message.kind,
              recipient: message.recipient,
              messageJson,
              createdAt: Number(message.createdAt),
              expiresAt: Number(message.expiresAt),
            })
            .onConflictDoUpdate({
              target: appDevEmailMessage.id,
              set: {
                kind: message.kind,
                recipient: message.recipient,
                messageJson,
                createdAt: Number(message.createdAt),
                expiresAt: Number(message.expiresAt),
              },
            });
          const retainedMessages = database
            .select({ id: appDevEmailMessage.id })
            .from(appDevEmailMessage)
            .orderBy(desc(appDevEmailMessage.createdAt))
            .limit(100);
          const trim = database
            .delete(appDevEmailMessage)
            .where(notInArray(appDevEmailMessage.id, retainedMessages));

          yield* storeOperation(
            "save",
            batch.execute([upsert.toSQL(), trim.toSQL()])
          );
        }),
      list: (options: DevEmailListOptions = {}) => {
        const limit = Math.min(
          100,
          Math.max(0, Math.floor(options.limit ?? 50))
        );
        const query = database
          .select({ messageJson: appDevEmailMessage.messageJson })
          .from(appDevEmailMessage)
          .where(
            and(
              options.recipient === undefined
                ? undefined
                : eq(appDevEmailMessage.recipient, options.recipient),
              options.kind === undefined
                ? undefined
                : eq(appDevEmailMessage.kind, options.kind)
            )
          )
          .orderBy(desc(appDevEmailMessage.createdAt))
          .limit(limit);

        return Effect.gen(function* () {
          const rows = yield* storeOperation("list", query);
          return yield* Effect.all(
            rows.map(({ messageJson }) => decodeMessage(messageJson))
          );
        });
      },
      clear: () =>
        storeOperation("clear", database.delete(appDevEmailMessage)).pipe(
          Effect.asVoid
        ),
    });
  })
);
