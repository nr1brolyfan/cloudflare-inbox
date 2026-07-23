import { DevEmailStore, DevEmailStoreError } from "@effect-auth/core/DevEmail";
import type {
  DevEmailListOptions,
  DevEmailMessage,
  DevEmailStoreOperation,
} from "@effect-auth/core/DevEmail";
import { makeDrizzleEffectSqliteExecutor } from "@effect-auth/core/DrizzleEffectSqliteStorage";
import {
  EffectQbSqliteAuthStorageLive,
  makeD1EffectQbSqliteAtomicPlanExecutor,
} from "@effect-auth/core/EffectQbSqliteStorage";
import { EmailSchema, UnixMillisSchema } from "@effect-auth/core/Identifiers";
import { and, desc, eq, notInArray } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { ControlPlaneBatch } from "#/platform/control-plane-d1/ControlPlaneBatch";
import {
  ControlPlaneD1Binding,
  ControlPlaneDatabase,
} from "#/platform/control-plane-d1/ControlPlaneDatabase";

import { appDevEmailMessage } from "./AccountSecuritySchema";

const DevEmailKindSchema = Schema.Literals([
  "EmailAuth",
  "EmailOtp",
  "MagicLink",
  "PasswordReset",
  "EmailVerification",
  "LoginApproval",
  "LoginNotification",
]);

const DevEmailAddressSchema = Schema.Union([
  EmailSchema,
  Schema.Struct({
    email: EmailSchema,
    name: Schema.optional(Schema.String),
  }),
]);

const PersistedDevEmailMessageSchema = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.String,
    kind: DevEmailKindSchema,
    recipient: EmailSchema,
    sender: Schema.optional(DevEmailAddressSchema),
    subject: Schema.String,
    text: Schema.optional(Schema.String),
    html: Schema.optional(Schema.String),
    headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    createdAt: UnixMillisSchema,
    expiresAt: UnixMillisSchema,
  })
);

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
  Schema.decodeUnknownEffect(PersistedDevEmailMessageSchema)(messageJson).pipe(
    Effect.mapError((cause) => storeError("list", cause))
  );

/** Shared auth stores use Drizzle for queries and raw D1 only for atomic plans. */
export const EffectAuthStorageD1Layer = Layer.unwrap(
  Effect.gen(function* () {
    const database = yield* ControlPlaneDatabase;
    const d1 = yield* ControlPlaneD1Binding;

    return EffectQbSqliteAuthStorageLive(
      makeDrizzleEffectSqliteExecutor(database),
      makeD1EffectQbSqliteAtomicPlanExecutor(d1.database)
    );
  })
);

/** Development mailbox using the same control-plane D1 adapter and batch. */
export const DevEmailStoreD1Layer = Layer.effect(
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

          yield* storeOperation("save", batch.execute([upsert, trim]));
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
