import {
  CredentialId,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import {
  RecoveryCodeHash,
  RecoveryCodeStore,
  RecoveryCodeStoreError,
  makeRecoveryCodeRecord,
} from "@effect-auth/core/RecoveryCodeStorage";
import type {
  RecoveryCodeRecord,
  RecoveryCodeStoreOperation,
} from "@effect-auth/core/RecoveryCodeStorage";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { authRecoveryCode } from "#/auth/schema/index";
import { ControlPlaneBatch } from "#/platform/control-plane-d1/ControlPlaneBatch";
import type { ControlPlaneStatements } from "#/platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";

const selection = {
  codeHash: authRecoveryCode.codeHash,
  createdAt: authRecoveryCode.createdAt,
  id: authRecoveryCode.id,
  metadata: authRecoveryCode.metadata,
  revokedAt: authRecoveryCode.revokedAt,
  usedAt: authRecoveryCode.usedAt,
  userId: authRecoveryCode.userId,
};

const storeError = (
  operation: RecoveryCodeStoreOperation,
  cause: unknown
): RecoveryCodeStoreError =>
  new RecoveryCodeStoreError({
    cause,
    message: `Recovery code ${operation} failed`,
    operation,
  });

const insertValues = (row: RecoveryCodeRecord) => ({
  codeHash: row.codeHash,
  createdAt: Number(row.createdAt),
  id: row.id,
  metadata: row.metadata === undefined ? null : JSON.stringify(row.metadata),
  revokedAt: row.revokedAt === undefined ? null : Number(row.revokedAt),
  usedAt: row.usedAt === undefined ? null : Number(row.usedAt),
  userId: row.userId,
});

const omitUndefined = <A extends Record<string, unknown>>(value: A) =>
  Object.fromEntries(
    Object.entries(value).filter(([, member]) => member !== undefined)
  ) as A;

const metadataDecode = (value: string | null) => {
  if (value === null) {
    return;
  }
  const decoded: unknown = JSON.parse(value);
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    Array.isArray(decoded)
  ) {
    throw new TypeError("Recovery code metadata must be an object");
  }
  return decoded as Readonly<Record<string, unknown>>;
};

const makeRecoveryCodeHash = Schema.decodeUnknownSync(RecoveryCodeHash);

const decode = (
  operation: RecoveryCodeStoreOperation,
  row: typeof authRecoveryCode.$inferSelect
): Effect.Effect<RecoveryCodeRecord, RecoveryCodeStoreError> =>
  Effect.try({
    try: () =>
      makeRecoveryCodeRecord(
        omitUndefined({
          codeHash: makeRecoveryCodeHash(row.codeHash),
          createdAt: UnixMillis(row.createdAt),
          id: CredentialId(row.id),
          metadata: metadataDecode(row.metadata),
          revokedAt:
            row.revokedAt === null ? undefined : UnixMillis(row.revokedAt),
          usedAt: row.usedAt === null ? undefined : UnixMillis(row.usedAt),
          userId: UserId(row.userId),
        })
      ),
    catch: (cause) => storeError(operation, cause),
  });

/** Native Drizzle D1 implementation of effect-auth's recovery-code store. */
export const RecoveryCodeStoreD1Layer = Layer.effect(
  RecoveryCodeStore,
  Effect.gen(function* () {
    const database = yield* ControlPlaneDatabase;
    const batch = yield* ControlPlaneBatch;

    return RecoveryCodeStore.of({
      insertMany: (rows) =>
        Effect.try({
          try: () => rows.map(insertValues),
          catch: (cause) => storeError("insert", cause),
        }).pipe(
          Effect.flatMap((values) => {
            if (values.length === 0) {
              return Effect.void;
            }
            return batch.execute(
              values.map((value) =>
                database.insert(authRecoveryCode).values(value)
              ) as unknown as ControlPlaneStatements
            );
          }),
          Effect.mapError((cause) =>
            cause instanceof RecoveryCodeStoreError
              ? cause
              : storeError("insert", cause)
          ),
          Effect.asVoid
        ),
      findById: (id) =>
        database
          .select(selection)
          .from(authRecoveryCode)
          .where(eq(authRecoveryCode.id, id))
          .limit(1)
          .pipe(
            Effect.mapError((cause) => storeError("find", cause)),
            Effect.flatMap((rows) =>
              rows[0] === undefined
                ? Effect.succeed(Option.none())
                : decode("find", rows[0]).pipe(Effect.map(Option.some))
            )
          ),
      listByUser: (input) =>
        database
          .select(selection)
          .from(authRecoveryCode)
          .where(
            and(
              eq(authRecoveryCode.userId, input.userId),
              input.includeUsed === true
                ? undefined
                : isNull(authRecoveryCode.usedAt),
              input.includeRevoked === true
                ? undefined
                : isNull(authRecoveryCode.revokedAt)
            )
          )
          .orderBy(asc(authRecoveryCode.createdAt), asc(authRecoveryCode.id))
          .pipe(
            Effect.mapError((cause) => storeError("list", cause)),
            Effect.flatMap((rows) =>
              Effect.all(rows.map((row) => decode("list", row)))
            )
          ),
      markUsed: (input) =>
        Effect.try({
          try: () =>
            input.metadata === undefined
              ? undefined
              : JSON.stringify(input.metadata),
          catch: (cause) => storeError("mark-used", cause),
        }).pipe(
          Effect.flatMap((metadata) =>
            database
              .update(authRecoveryCode)
              .set({ metadata, usedAt: Number(input.usedAt) })
              .where(
                and(
                  eq(authRecoveryCode.id, input.id),
                  isNull(authRecoveryCode.usedAt),
                  isNull(authRecoveryCode.revokedAt)
                )
              )
              .returning(selection)
          ),
          Effect.mapError((cause) =>
            cause instanceof RecoveryCodeStoreError
              ? cause
              : storeError("mark-used", cause)
          ),
          Effect.flatMap((rows) =>
            rows[0] === undefined
              ? Effect.succeed(Option.none())
              : decode("mark-used", rows[0]).pipe(Effect.map(Option.some))
          )
        ),
      replaceActiveForUser: (input) =>
        Effect.try({
          try: () => input.rows.map(insertValues),
          catch: (cause) => storeError("replace-active", cause),
        }).pipe(
          Effect.flatMap((values) =>
            batch.execute([
              database
                .update(authRecoveryCode)
                .set({
                  metadata:
                    input.revokeReason === undefined
                      ? undefined
                      : sql<string>`json_patch(coalesce(${authRecoveryCode.metadata}, '{}'), json_object('revokeReason', ${input.revokeReason}))`,
                  revokedAt: Number(input.revokedAt),
                })
                .where(
                  and(
                    eq(authRecoveryCode.userId, input.userId),
                    isNull(authRecoveryCode.usedAt),
                    isNull(authRecoveryCode.revokedAt)
                  )
                ),
              ...values.map((value) =>
                database.insert(authRecoveryCode).values(value)
              ),
            ])
          ),
          Effect.mapError((cause) =>
            cause instanceof RecoveryCodeStoreError
              ? cause
              : storeError("replace-active", cause)
          ),
          Effect.asVoid
        ),
      revoke: (input) =>
        database
          .update(authRecoveryCode)
          .set({
            metadata:
              input.reason === undefined
                ? undefined
                : sql<string>`json_patch(coalesce(${authRecoveryCode.metadata}, '{}'), json_object('revokeReason', ${input.reason}))`,
            revokedAt: Number(input.revokedAt),
          })
          .where(eq(authRecoveryCode.id, input.id))
          .pipe(
            Effect.mapError((cause) => storeError("revoke", cause)),
            Effect.asVoid
          ),
    });
  })
);
