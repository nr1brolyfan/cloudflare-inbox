import {
  CredentialId,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import {
  PasskeyCredentialId,
  PasskeyCredentialStore,
  PasskeyCredentialStoreError,
} from "@effect-auth/core/Passkey";
import type {
  PasskeyCredentialRecord,
  PasskeyCredentialStoreOperation,
} from "@effect-auth/core/Passkey";
import { normalizePasskeyTransports } from "@effect-auth/core/PasskeyCredentialPayload";
import { and, asc, count, eq, isNull, lt, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { authPasskeyCredential } from "#/auth/schema/index";
import { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";

const selection = {
  backedUp: authPasskeyCredential.backedUp,
  createdAt: authPasskeyCredential.createdAt,
  credentialId: authPasskeyCredential.credentialId,
  id: authPasskeyCredential.id,
  lastUsedAt: authPasskeyCredential.lastUsedAt,
  metadata: authPasskeyCredential.metadata,
  name: authPasskeyCredential.name,
  publicKey: authPasskeyCredential.publicKey,
  revokedAt: authPasskeyCredential.revokedAt,
  signCount: authPasskeyCredential.signCount,
  transports: authPasskeyCredential.transports,
  userId: authPasskeyCredential.userId,
};

const storeError = (
  operation: PasskeyCredentialStoreOperation,
  cause: unknown
): PasskeyCredentialStoreError =>
  new PasskeyCredentialStoreError({
    cause,
    message: `Passkey credential ${operation} failed`,
    operation,
  });

const jsonEncode = (value: unknown): string | null =>
  value === undefined ? null : JSON.stringify(value);

const jsonDecode = (value: string | null): unknown =>
  value === null ? undefined : JSON.parse(value);

const metadataDecode = (value: string | null) => {
  const decoded = jsonDecode(value);
  if (
    decoded !== undefined &&
    (typeof decoded !== "object" || decoded === null || Array.isArray(decoded))
  ) {
    throw new TypeError("Passkey credential metadata must be an object");
  }
  return decoded as Readonly<Record<string, unknown>> | undefined;
};

const omitUndefined = <A extends Record<string, unknown>>(value: A) =>
  Object.fromEntries(
    Object.entries(value).filter(([, member]) => member !== undefined)
  ) as A;

const insertValues = (row: PasskeyCredentialRecord) => ({
  backedUp: row.backedUp === undefined ? null : row.backedUp ? 1 : 0,
  createdAt: Number(row.createdAt),
  credentialId: row.credentialId,
  id: row.id,
  lastUsedAt: row.lastUsedAt === undefined ? null : Number(row.lastUsedAt),
  metadata: jsonEncode(row.metadata),
  name: row.name ?? null,
  publicKey: row.publicKey,
  revokedAt: row.revokedAt === undefined ? null : Number(row.revokedAt),
  signCount: row.signCount,
  transports: jsonEncode(row.transports),
  userId: row.userId,
});

const decode = (
  operation: PasskeyCredentialStoreOperation,
  row: typeof authPasskeyCredential.$inferSelect
): Effect.Effect<PasskeyCredentialRecord, PasskeyCredentialStoreError> =>
  Effect.try({
    try: () =>
      omitUndefined({
        backedUp: row.backedUp === null ? undefined : row.backedUp !== 0,
        createdAt: UnixMillis(row.createdAt),
        credentialId: PasskeyCredentialId(row.credentialId),
        id: CredentialId(row.id),
        lastUsedAt:
          row.lastUsedAt === null ? undefined : UnixMillis(row.lastUsedAt),
        metadata: metadataDecode(row.metadata),
        name: row.name ?? undefined,
        publicKey: row.publicKey,
        revokedAt:
          row.revokedAt === null ? undefined : UnixMillis(row.revokedAt),
        signCount: row.signCount,
        transports:
          row.transports === null
            ? undefined
            : normalizePasskeyTransports(jsonDecode(row.transports)),
        userId: UserId(row.userId),
      }) as PasskeyCredentialRecord,
    catch: (cause) => storeError(operation, cause),
  });

/** Native Drizzle D1 implementation of effect-auth's passkey credential store. */
export const PasskeyCredentialStoreD1Layer = Layer.effect(
  PasskeyCredentialStore,
  Effect.gen(function* () {
    const database = yield* ControlPlaneDatabase;

    return PasskeyCredentialStore.of({
      insert: (row) =>
        Effect.try({
          try: () => insertValues(row),
          catch: (cause) => storeError("insert", cause),
        }).pipe(
          Effect.flatMap((values) =>
            database.insert(authPasskeyCredential).values(values)
          ),
          Effect.mapError((cause) =>
            cause instanceof PasskeyCredentialStoreError
              ? cause
              : storeError("insert", cause)
          ),
          Effect.asVoid
        ),
      insertWithinLimit: (input) =>
        Effect.try({
          try: () => insertValues(input.credential),
          catch: (cause) => storeError("insert-within-limit", cause),
        }).pipe(
          Effect.flatMap((values) => {
            const active = database
              .select({ count: count().as("count") })
              .from(authPasskeyCredential)
              .where(
                and(
                  eq(authPasskeyCredential.userId, input.credential.userId),
                  isNull(authPasskeyCredential.revokedAt)
                )
              )
              .as("active_passkey_credential");

            return database
              .insert(authPasskeyCredential)
              .select(
                database
                  .select({
                    backedUp: sql<number | null>`${values.backedUp}`.as(
                      "backed_up"
                    ),
                    createdAt: sql<number>`${values.createdAt}`.as(
                      "created_at"
                    ),
                    credentialId: sql<string>`${values.credentialId}`.as(
                      "credential_id"
                    ),
                    id: sql<string>`${values.id}`.as("id"),
                    lastUsedAt: sql<number | null>`${values.lastUsedAt}`.as(
                      "last_used_at"
                    ),
                    metadata: sql<string | null>`${values.metadata}`.as(
                      "metadata"
                    ),
                    name: sql<string | null>`${values.name}`.as("name"),
                    publicKey: sql<string>`${values.publicKey}`.as(
                      "public_key"
                    ),
                    revokedAt: sql<number | null>`${values.revokedAt}`.as(
                      "revoked_at"
                    ),
                    signCount: sql<number>`${values.signCount}`.as(
                      "sign_count"
                    ),
                    transports: sql<string | null>`${values.transports}`.as(
                      "transports"
                    ),
                    userId: sql<string>`${values.userId}`.as("user_id"),
                  })
                  .from(active)
                  .where(lt(active.count, input.maximumActiveCredentials))
              )
              .returning({ id: authPasskeyCredential.id });
          }),
          Effect.mapError((cause) =>
            cause instanceof PasskeyCredentialStoreError
              ? cause
              : storeError("insert-within-limit", cause)
          ),
          Effect.map((rows) => rows.length === 1)
        ),
      findByCredentialId: (credentialId) =>
        database
          .select(selection)
          .from(authPasskeyCredential)
          .where(eq(authPasskeyCredential.credentialId, credentialId))
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
          .from(authPasskeyCredential)
          .where(
            and(
              eq(authPasskeyCredential.userId, input.userId),
              input.includeRevoked === true
                ? undefined
                : isNull(authPasskeyCredential.revokedAt)
            )
          )
          .orderBy(
            asc(authPasskeyCredential.createdAt),
            asc(authPasskeyCredential.id)
          )
          .pipe(
            Effect.mapError((cause) => storeError("list", cause)),
            Effect.flatMap((rows) =>
              Effect.all(rows.map((row) => decode("list", row)))
            )
          ),
      updateSignCount: (input) => {
        const metadata = Effect.try({
          try: () =>
            input.metadata === undefined
              ? undefined
              : jsonEncode(input.metadata),
          catch: (cause) => storeError("update-sign-count", cause),
        });

        return metadata.pipe(
          Effect.flatMap((metadataJson) =>
            database
              .update(authPasskeyCredential)
              .set({
                backedUp:
                  input.backedUp === undefined
                    ? undefined
                    : input.backedUp
                      ? 1
                      : 0,
                lastUsedAt: Number(input.lastUsedAt),
                metadata: metadataJson,
                signCount: input.signCount,
              })
              .where(
                and(
                  eq(authPasskeyCredential.credentialId, input.credentialId),
                  eq(authPasskeyCredential.signCount, input.expectedSignCount),
                  isNull(authPasskeyCredential.revokedAt)
                )
              )
              .returning(selection)
          ),
          Effect.mapError((cause) =>
            cause instanceof PasskeyCredentialStoreError
              ? cause
              : storeError("update-sign-count", cause)
          ),
          Effect.flatMap((rows) =>
            rows[0] === undefined
              ? Effect.succeed(Option.none())
              : decode("update-sign-count", rows[0]).pipe(
                  Effect.map(Option.some)
                )
          )
        );
      },
      revoke: (input) =>
        database
          .update(authPasskeyCredential)
          .set({
            metadata:
              input.reason === undefined
                ? undefined
                : sql<string>`json_patch(coalesce(${authPasskeyCredential.metadata}, '{}'), json_object('revokeReason', ${input.reason}))`,
            revokedAt: Number(input.revokedAt),
          })
          .where(eq(authPasskeyCredential.credentialId, input.credentialId))
          .pipe(
            Effect.mapError((cause) => storeError("revoke", cause)),
            Effect.asVoid
          ),
    });
  })
);
