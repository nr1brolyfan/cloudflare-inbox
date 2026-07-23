import { CustomAuditEventSchema } from "@effect-auth/core/AuditLog";
import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import * as AuthPermission from "@effect-auth/core/Permission";
import { RecoveryCodes } from "@effect-auth/core/RecoveryCode";
import { and, eq, exists, isNull, notExists, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { authAuditLog } from "#/auth/schema/modules/audit-log";
import { authUser } from "#/auth/schema/modules/core";
import { authRecoveryCode } from "#/auth/schema/modules/recovery-codes";
import {
  GenerateRecoveryCodesCommand,
  ReadRecoveryCodeRotationQuery,
  RecoveryCodeAdministration,
  RecoveryCodeAdministrationError,
  RecoveryCodesAlreadyGenerated,
  RecoveryCodesGenerated,
  RecoveryCodeRotationReceiptSchema,
  RecoveryCodeSetId,
  RecoveryCodeText,
} from "#/modules/account-security/application/RecoveryCodeAdministration";
import type { RecoveryCodeRotationReceipt } from "#/modules/account-security/application/RecoveryCodeAdministration";
import { requireSensitiveOperationStepUp } from "#/modules/account-security/domain/StepUpPolicy";
import {
  sensitiveSessionPredicate,
  transactionalSessionPredicate,
} from "#/modules/account-security/integration/AccountSecurityD1RequestGuard";
import { RecoveryCodeAdministrationTransaction } from "#/modules/account-security/ports/RecoveryCodeAdministrationTransaction";
import { SensitiveOperationStepUpClock } from "#/modules/account-security/ports/SensitiveOperationStepUpClock";
import { appAuthorizationGuard } from "#/platform/control-plane-d1/AuthorizationGuardSchema";
import * as ControlPlane from "#/platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import { controlPlaneDatabaseNow } from "#/platform/control-plane-d1/RequestAuthGuard";
import { CurrentRequestAuth } from "#/shared/RequestAuth";
import type { CurrentRequestAuthShape } from "#/shared/RequestAuth";
import { UnixMillis } from "#/shared/Temporal";

import {
  appExternalRecoveryIdentity,
  appRecoveryCodeRotationReceipt,
} from "./AccountSecuritySchema";

const failure = (
  operation: RecoveryCodeAdministrationError["operation"],
  reason: RecoveryCodeAdministrationError["reason"],
  cause?: unknown
) => new RecoveryCodeAdministrationError({ cause, operation, reason });

const ensureTrusted = (
  requestAuth: CurrentRequestAuthShape,
  principal: AuthPermission.PermissionSubject
) => {
  const { validated } = requestAuth;
  return principal.type === "user" &&
    principal.id === validated.actor.userId &&
    validated.actor.userId === validated.currentSession.userId &&
    validated.actor.userId === validated.issued.userId &&
    validated.actor.sessionId === validated.currentSession.sessionId &&
    validated.actor.sessionId === validated.issued.sessionId
    ? Effect.void
    : Effect.die(new Error("Current request auth contexts are inconsistent"));
};

const requireUnrestricted = (
  requestAuth: CurrentRequestAuthShape,
  operation: RecoveryCodeAdministrationError["operation"]
) =>
  (requestAuth.validated.currentSession.claims?.requirements?.length ?? 0) === 0
    ? Effect.void
    : Effect.fail(failure(operation, "restricted-session"));

const ReceiptRow = Schema.Struct({
  codeCount: Schema.Number,
  committedAt: Schema.Number,
  expectedPreviousSetId: Schema.NullOr(Schema.String),
  generatedAt: Schema.Number,
  operationId: Schema.String,
  resultingSetId: Schema.String,
  schemaVersion: Schema.Number,
  userId: Schema.String,
});

const receiptFromRow = (row: Schema.Schema.Type<typeof ReceiptRow>) =>
  Schema.decodeUnknownEffect(RecoveryCodeRotationReceiptSchema)({
    codeCount: row.codeCount,
    committedAt: row.committedAt,
    ...(row.expectedPreviousSetId === null
      ? {}
      : { expectedPreviousSetId: row.expectedPreviousSetId }),
    generatedAt: row.generatedAt,
    operationId: row.operationId,
    schemaVersion: row.schemaVersion,
    setId: row.resultingSetId,
    userId: row.userId,
  });

const SetMetadata = Schema.Struct({ setId: RecoveryCodeSetId });

/** Authenticated, replay-safe recovery-code rotation with one-time plaintext output. */
const RecoveryCodeAdministrationTransactionD1Layer = Layer.effect(
  RecoveryCodeAdministrationTransaction,
  Effect.gen(function* () {
    const authRateLimit = yield* AuthRateLimit;
    const batch = yield* ControlPlane.ControlPlaneBatch;
    const database = yield* ControlPlaneDatabase;
    const recoveryCodes = yield* RecoveryCodes;
    const stepUpClock = yield* SensitiveOperationStepUpClock;

    const requestContext = (
      operation: RecoveryCodeAdministrationError["operation"]
    ) =>
      Effect.gen(function* () {
        const requestAuth = yield* CurrentRequestAuth;
        const principal = yield* AuthPermission.CurrentPrincipal;
        yield* ensureTrusted(requestAuth, principal);
        yield* requireUnrestricted(requestAuth, operation);
        return requestAuth;
      });

    const readReceipt = (
      operationId: string,
      operation: RecoveryCodeAdministrationError["operation"]
    ): Effect.Effect<
      RecoveryCodeRotationReceipt | null,
      RecoveryCodeAdministrationError
    > =>
      database
        .select({
          codeCount: appRecoveryCodeRotationReceipt.codeCount,
          committedAt: appRecoveryCodeRotationReceipt.committedAt,
          expectedPreviousSetId:
            appRecoveryCodeRotationReceipt.expectedPreviousSetId,
          generatedAt: appRecoveryCodeRotationReceipt.generatedAt,
          operationId: appRecoveryCodeRotationReceipt.operationId,
          resultingSetId: appRecoveryCodeRotationReceipt.resultingSetId,
          schemaVersion: appRecoveryCodeRotationReceipt.schemaVersion,
          userId: appRecoveryCodeRotationReceipt.userId,
        })
        .from(appRecoveryCodeRotationReceipt)
        .where(eq(appRecoveryCodeRotationReceipt.operationId, operationId))
        .limit(1)
        .pipe(
          Effect.mapError((cause) => failure(operation, "storage", cause)),
          Effect.flatMap(([row]) =>
            row === undefined
              ? Effect.succeed(null)
              : Schema.decodeUnknownEffect(ReceiptRow)(row).pipe(
                  Effect.mapError((cause) =>
                    failure(operation, "storage", cause)
                  ),
                  Effect.flatMap(receiptFromRow),
                  Effect.mapError((cause) =>
                    cause instanceof RecoveryCodeAdministrationError
                      ? cause
                      : failure(operation, "storage", cause)
                  )
                )
          )
        );

    const snapshotActiveSet = (userId: string) =>
      database
        .select({ metadata: authRecoveryCode.metadata })
        .from(authRecoveryCode)
        .where(
          and(
            eq(authRecoveryCode.userId, userId),
            isNull(authRecoveryCode.usedAt),
            isNull(authRecoveryCode.revokedAt)
          )
        )
        .pipe(
          Effect.mapError((cause) => failure("generate", "storage", cause)),
          Effect.flatMap((rows) =>
            Effect.all(
              rows.map(({ metadata }) =>
                Effect.try({
                  try: () => JSON.parse(metadata ?? "") as unknown,
                  catch: (cause) => failure("generate", "storage", cause),
                }).pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(SetMetadata)),
                  Effect.mapError((cause) =>
                    cause instanceof RecoveryCodeAdministrationError
                      ? cause
                      : failure("generate", "storage", cause)
                  ),
                  Effect.filterOrFail(
                    (decoded) =>
                      metadata === JSON.stringify({ setId: decoded.setId }),
                    () => failure("generate", "storage")
                  )
                )
              )
            )
          ),
          Effect.flatMap((metadata) => {
            const [first] = metadata;
            return first === undefined ||
              metadata.every((entry) => entry.setId === first.setId)
              ? Effect.succeed(first?.setId)
              : Effect.fail(failure("generate", "storage"));
          })
        );

    return RecoveryCodeAdministrationTransaction.of({
      generate: (untrusted) =>
        // oxlint-disable-next-line eslint/complexity -- The transaction exhaustively maps each failed guard to its public-safe domain reason.
        Effect.gen(function* () {
          const command = yield* Schema.decodeUnknownEffect(
            GenerateRecoveryCodesCommand
          )(untrusted).pipe(
            Effect.mapError((cause) =>
              failure("generate", "invalid-input", cause)
            )
          );
          const requestAuth = yield* requestContext("generate");
          const { userId } = requestAuth.validated.actor;
          const replay = yield* readReceipt(command.operationId, "generate");
          if (replay !== null) {
            if (replay.userId !== userId) {
              return yield* failure("generate", "operation-conflict");
            }
            return RecoveryCodesAlreadyGenerated.make({
              _tag: "RecoveryCodesAlreadyGenerated",
              receipt: replay,
            });
          }
          yield* requireSensitiveOperationStepUp(
            requestAuth.validated.currentSession,
            stepUpClock.now()
          ).pipe(
            Effect.mapError(() => failure("generate", "step-up-required"))
          );
          yield* authRateLimit
            .require({ operation: "auth.recovery_code.generate", userId })
            .pipe(
              Effect.mapError((cause) =>
                failure(
                  "generate",
                  cause._tag === "RateLimitExceededError"
                    ? "rate-limited"
                    : "storage",
                  cause
                )
              )
            );

          const expectedPreviousSetId = yield* snapshotActiveSet(userId);
          const generatedAt = Schema.decodeUnknownSync(UnixMillis)(Date.now());
          const plaintext = yield* recoveryCodes
            .generate({ count: 10, groupSize: 4, length: 16 })
            .pipe(
              Effect.mapError((cause) => failure("generate", "storage", cause))
            );
          const records = yield* Effect.all(
            plaintext.map((code) =>
              recoveryCodes.hash({ code }).pipe(
                Effect.map((codeHash) => ({
                  codeHash,
                  id: crypto.randomUUID(),
                })),
                Effect.mapError((cause) =>
                  failure("generate", "storage", cause)
                )
              )
            )
          );
          const codes = yield* Schema.decodeUnknownEffect(
            Schema.Array(RecoveryCodeText).pipe(
              Schema.check(
                Schema.makeFilter((values) =>
                  values.length === 10
                    ? undefined
                    : "must contain exactly 10 codes"
                )
              )
            )
          )(plaintext.map((code) => Redacted.value(code))).pipe(
            Effect.mapError((cause) => failure("generate", "storage", cause))
          );
          const nonce = crypto.randomUUID();
          const setId = Schema.decodeUnknownSync(RecoveryCodeSetId)(
            crypto.randomUUID()
          );
          const metadata = JSON.stringify({ setId });
          const expectedMetadata =
            expectedPreviousSetId === undefined
              ? undefined
              : JSON.stringify({ setId: expectedPreviousSetId });
          const trustedStepUpSession = sensitiveSessionPredicate(
            database,
            requestAuth,
            generatedAt
          );
          const trustedBaseSession = transactionalSessionPredicate(
            database,
            requestAuth,
            generatedAt
          );
          const activeUser = exists(
            database
              .select({ value: sql`1` })
              .from(authUser)
              .where(and(eq(authUser.id, userId), isNull(authUser.disabledAt)))
          );
          const recoveryValid = exists(
            database
              .select({ value: sql`1` })
              .from(appExternalRecoveryIdentity)
              .where(
                and(
                  eq(appExternalRecoveryIdentity.userId, userId),
                  eq(appExternalRecoveryIdentity.status, "verified")
                )
              )
          );
          const activeCodePredicate = and(
            eq(authRecoveryCode.userId, userId),
            isNull(authRecoveryCode.usedAt),
            isNull(authRecoveryCode.revokedAt)
          );
          const expectedStateValid =
            expectedMetadata === undefined
              ? notExists(
                  database
                    .select({ value: sql`1` })
                    .from(authRecoveryCode)
                    .where(activeCodePredicate)
                )
              : and(
                  exists(
                    database
                      .select({ value: sql`1` })
                      .from(authRecoveryCode)
                      .where(
                        and(
                          activeCodePredicate,
                          eq(authRecoveryCode.metadata, expectedMetadata)
                        )
                      )
                  ),
                  notExists(
                    database
                      .select({ value: sql`1` })
                      .from(authRecoveryCode)
                      .where(
                        and(
                          activeCodePredicate,
                          sql`${authRecoveryCode.metadata} is not ${expectedMetadata}`
                        )
                      )
                  )
                );
          const operationAvailable = notExists(
            database
              .select({ value: sql`1` })
              .from(appRecoveryCodeRotationReceipt)
              .where(
                eq(
                  appRecoveryCodeRotationReceipt.operationId,
                  command.operationId
                )
              )
          );
          const authorized = exists(
            database
              .select({ value: sql`1` })
              .from(appAuthorizationGuard)
              .where(eq(appAuthorizationGuard.nonce, nonce))
          );
          const auditEvent = yield* Schema.decodeUnknownEffect(
            CustomAuditEventSchema
          )({
            actor: {
              sessionId: requestAuth.validated.actor.sessionId,
              type: "user",
              userId,
            },
            occurredAt: generatedAt,
            payload: { codeCount: 10, operationId: command.operationId, setId },
            subject: { type: "user", userId },
            type: "app.recovery_codes.generated",
            version: 1,
          }).pipe(
            Effect.mapError((cause) => failure("generate", "storage", cause))
          );
          const statements: ControlPlane.ControlPlaneStatements = [
            database.insert(appAuthorizationGuard).select(
              sql`select ${nonce} where ${trustedStepUpSession}
                      and ${activeUser} and ${recoveryValid}
                      and ${expectedStateValid} and ${operationAvailable}`
            ),
            database.all(sql`select cast(${trustedBaseSession} as integer)
                                      as session_valid,
                                   cast(${trustedStepUpSession} as integer)
                                      as step_up_valid,
                                   cast(${activeUser} as integer)
                                      as user_active,
                                   cast(${recoveryValid} as integer)
                                      as recovery_valid,
                                   cast(${expectedStateValid} as integer)
                                      as expected_state_valid,
                                   cast(${operationAvailable} as integer)
                                      as operation_available,
                                   cast(${authorized} as integer) as authorized`),
            database
              .update(authRecoveryCode)
              .set({
                revokedAt: sql<number>`max(
                  ${generatedAt},
                  ${authRecoveryCode.createdAt},
                  ${controlPlaneDatabaseNow}
                )`,
              })
              .where(
                and(
                  eq(authRecoveryCode.userId, userId),
                  isNull(authRecoveryCode.usedAt),
                  isNull(authRecoveryCode.revokedAt),
                  authorized
                )
              ),
            ...records.map((record) =>
              database.insert(authRecoveryCode).select(
                sql`select ${record.id}, ${userId}, ${record.codeHash},
                           ${generatedAt}, null, null, ${metadata}
                    where ${authorized}`
              )
            ),
            database
              .insert(appRecoveryCodeRotationReceipt)
              .select(
                database
                  .select({
                    codeCount: sql<10>`10`.as("code_count"),
                    committedAt: sql`${generatedAt}`.as("committed_at"),
                    expectedPreviousSetId:
                      expectedPreviousSetId === undefined
                        ? sql<null>`null`.as("expected_previous_set_id")
                        : sql`${expectedPreviousSetId}`.as(
                            "expected_previous_set_id"
                          ),
                    generatedAt: sql`${generatedAt}`.as("generated_at"),
                    operationId: sql`${command.operationId}`.as("operation_id"),
                    resultingSetId: sql`${setId}`.as("resulting_set_id"),
                    schemaVersion: sql<1>`1`.as("schema_version"),
                    userId: sql`${userId}`.as("user_id"),
                  })
                  .from(appAuthorizationGuard)
                  .where(eq(appAuthorizationGuard.nonce, nonce))
              )
              .returning({
                operation_id: appRecoveryCodeRotationReceipt.operationId,
              }),
            database.insert(authAuditLog).select(
              database
                .select({
                  actorUserId: sql`${userId}`.as("actor_user_id"),
                  createdAt: sql`${generatedAt}`.as("created_at"),
                  event: sql`${JSON.stringify(auditEvent)}`.as("event"),
                  id: sql`${`recovery-code-rotation:${command.operationId}`}`.as(
                    "id"
                  ),
                  occurredAt: sql`${generatedAt}`.as("occurred_at"),
                  type: sql`${auditEvent.type}`.as("type"),
                  userId: sql`${userId}`.as("user_id"),
                })
                .from(appAuthorizationGuard)
                .where(eq(appAuthorizationGuard.nonce, nonce))
            ),
            database
              .delete(appAuthorizationGuard)
              .where(eq(appAuthorizationGuard.nonce, nonce)),
          ];
          const results = yield* batch.execute(statements).pipe(
            Effect.catchTag("ControlPlaneBatchError", (cause) =>
              cause.commitState === "unknown"
                ? readReceipt(command.operationId, "generate").pipe(
                    Effect.flatMap((receipt) =>
                      receipt === null
                        ? Effect.fail(
                            new RecoveryCodeAdministrationError({
                              cause: cause.cause,
                              commitState: "unknown",
                              operation: "generate",
                              reason: "indeterminate",
                            })
                          )
                        : receipt.userId === userId
                          ? Effect.succeed(
                              RecoveryCodesAlreadyGenerated.make({
                                _tag: "RecoveryCodesAlreadyGenerated",
                                receipt,
                              })
                            )
                          : Effect.fail(
                              failure("generate", "operation-conflict")
                            )
                    )
                  )
                : Effect.fail(
                    new RecoveryCodeAdministrationError({
                      cause: cause.cause,
                      commitState: cause.commitState,
                      operation: "generate",
                      reason: "storage",
                    })
                  )
            )
          );
          if (results instanceof RecoveryCodesAlreadyGenerated) {
            return results;
          }
          const [status] = yield* Schema.decodeUnknownEffect(
            Schema.Array(
              Schema.Struct({
                authorized: Schema.Number,
                expected_state_valid: Schema.Number,
                operation_available: Schema.Number,
                recovery_valid: Schema.Number,
                session_valid: Schema.Number,
                step_up_valid: Schema.Number,
                user_active: Schema.Number,
              })
            )
          )(results[1]?.results).pipe(
            Effect.mapError((cause) => failure("generate", "storage", cause))
          );
          if (status?.authorized !== 1) {
            if (status?.session_valid !== 1 || status.user_active !== 1) {
              return yield* failure("generate", "unauthenticated");
            }
            if (status.step_up_valid !== 1) {
              return yield* failure("generate", "step-up-required");
            }
            if (status.recovery_valid !== 1) {
              return yield* failure("generate", "recovery-identity-required");
            }
            if (status.operation_available !== 1) {
              const concurrentReplay = yield* readReceipt(
                command.operationId,
                "generate"
              );
              if (concurrentReplay?.userId === userId) {
                return RecoveryCodesAlreadyGenerated.make({
                  _tag: "RecoveryCodesAlreadyGenerated",
                  receipt: concurrentReplay,
                });
              }
              return yield* failure("generate", "operation-conflict");
            }
            if (status.expected_state_valid !== 1) {
              return yield* failure("generate", "state-conflict");
            }
            return yield* failure("generate", "storage");
          }
          const receiptRows = yield* Schema.decodeUnknownEffect(
            Schema.Array(Schema.Struct({ operation_id: Schema.String }))
          )(results[13]?.results).pipe(
            Effect.mapError((cause) => failure("generate", "storage", cause))
          );
          if (receiptRows[0]?.operation_id !== command.operationId) {
            return yield* failure("generate", "storage");
          }
          const receipt = yield* Schema.decodeUnknownEffect(
            RecoveryCodeRotationReceiptSchema
          )({
            codeCount: 10,
            committedAt: generatedAt,
            ...(expectedPreviousSetId === undefined
              ? {}
              : { expectedPreviousSetId }),
            generatedAt,
            operationId: command.operationId,
            schemaVersion: 1,
            setId,
            userId,
          }).pipe(
            Effect.mapError((cause) => failure("generate", "storage", cause))
          );
          return RecoveryCodesGenerated.make({
            _tag: "RecoveryCodesGenerated",
            codes,
            receipt,
          });
        }),
      readOperation: (untrusted) =>
        Effect.gen(function* () {
          const query = yield* Schema.decodeUnknownEffect(
            ReadRecoveryCodeRotationQuery
          )(untrusted).pipe(
            Effect.mapError((cause) =>
              failure("read-operation", "invalid-input", cause)
            )
          );
          const requestAuth = yield* requestContext("read-operation");
          const receipt = yield* readReceipt(
            query.operationId,
            "read-operation"
          );
          if (
            receipt === null ||
            receipt.userId !== requestAuth.validated.actor.userId
          ) {
            return yield* failure("read-operation", "not-found");
          }
          return receipt;
        }),
    });
  })
);

export const RecoveryCodeAdministrationD1Layer =
  RecoveryCodeAdministration.layerNoDeps.pipe(
    Layer.provide(RecoveryCodeAdministrationTransactionD1Layer)
  );
