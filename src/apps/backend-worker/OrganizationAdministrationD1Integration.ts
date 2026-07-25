import * as AuthPermission from "@effect-auth/core/Permission";
import { and, eq, exists, isNull, notExists, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  CONTROL_PLANE_STEP_UP_POLICY,
  requireSensitiveOperationStepUp,
} from "#/modules/account-security/domain/StepUpPolicy";
import { sensitiveSessionPredicate } from "#/modules/account-security/integration/AccountSecurityD1RequestGuard";
import { SensitiveOperationStepUpClock } from "#/modules/account-security/ports/SensitiveOperationStepUpClock";
import { AdministrativeAudit } from "#/modules/administrative-audit/contracts/AdministrativeAudit";
import type { AdministrativeAuditError } from "#/modules/administrative-audit/contracts/AdministrativeAuditError";
import { administrativeAuditInsertStatement } from "#/modules/administrative-audit/integration/AdministrativeAuditD1Statements";
import {
  AuthorizationPermission,
  makeOrganizationScopeId,
  organizationScope,
} from "#/modules/authorization/contracts/AuthorizationCatalog";
import {
  appOrganizationAdministrationReceipt,
  appOrganizationLifecycleActivation,
  appOrganizationMember,
  appOrganizationOperationFence,
} from "#/modules/organization/adapters/d1/OrganizationSchema";
import {
  OrganizationAdministration,
  OrganizationAdministrationError,
  OrganizationAdministrationReceipt,
  OrganizationAdministrationReceiptSchema,
  ReadOrganizationAdministrationOperationQuery,
  ResumeOrganizationCommand,
  SuspendOrganizationCommand,
} from "#/modules/organization/application/OrganizationAdministration";
import type {
  OrganizationAdministrationOperation,
  ResumeOrganizationCommand as ResumeCommand,
  SuspendOrganizationCommand as SuspendCommand,
} from "#/modules/organization/application/OrganizationAdministration";
import {
  ORGANIZATION_OPERATION_MATRIX_ID,
  ORGANIZATION_OPERATION_MATRIX_VERSION,
  organizationLifecycleTransition,
} from "#/modules/organization/domain/Organization";
import { OrganizationAdministrationTransaction } from "#/modules/organization/ports/OrganizationAdministrationTransaction";
import { appAuthorizationGuard } from "#/platform/control-plane-d1/AuthorizationGuardSchema";
import * as ControlPlane from "#/platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import { appOrganization } from "#/platform/control-plane-d1/OrganizationRootSchema";
import { exactScopePermissionPredicate } from "#/platform/control-plane-d1/PermissionGuard";
import { CurrentRequestAuth } from "#/shared/RequestAuth";
import type { CurrentRequestAuthShape } from "#/shared/RequestAuth";
import { UnixMillis } from "#/shared/Temporal";

export interface OrganizationAdministrationRuntime {
  readonly now: () => number;
  readonly randomId: () => string;
}

export const OrganizationAdministrationRuntime =
  Context.Service<OrganizationAdministrationRuntime>(
    "cloudflare-inbox/OrganizationAdministrationRuntime"
  );

export const OrganizationAdministrationRuntimeLayer = Layer.succeed(
  OrganizationAdministrationRuntime,
  OrganizationAdministrationRuntime.of({
    now: Date.now,
    randomId: () => crypto.randomUUID(),
  })
);

const ReceiptRow = Schema.Struct({
  actor_user_id: Schema.String,
  audit_event_id: Schema.String,
  committed_at: Schema.Number,
  expected_version: Schema.Number,
  matrix_id: Schema.String,
  matrix_version: Schema.Number,
  operation_id: Schema.String,
  operation_kind: Schema.String,
  organization_id: Schema.String,
  result_created_at: Schema.Number,
  result_status: Schema.String,
  result_updated_at: Schema.Number,
  result_version: Schema.Number,
  schema_version: Schema.Number,
  step_up_policy_id: Schema.String,
  step_up_policy_version: Schema.Number,
});

const LifecycleStatusRow = Schema.Struct({
  authorized: Schema.Number,
  membership_valid: Schema.Number,
  operation_available: Schema.Number,
  operations_drained: Schema.Number,
  organization_exists: Schema.Number,
  permission_valid: Schema.Number,
  protocol_active: Schema.Number,
  session_valid: Schema.Number,
  state_valid: Schema.Number,
});

const receiptReturning = {
  actor_user_id: appOrganizationAdministrationReceipt.actorUserId,
  audit_event_id: appOrganizationAdministrationReceipt.auditEventId,
  committed_at: appOrganizationAdministrationReceipt.committedAt,
  expected_version: appOrganizationAdministrationReceipt.expectedVersion,
  matrix_id: appOrganizationAdministrationReceipt.matrixId,
  matrix_version: appOrganizationAdministrationReceipt.matrixVersion,
  operation_id: appOrganizationAdministrationReceipt.operationId,
  operation_kind: appOrganizationAdministrationReceipt.operationKind,
  organization_id: appOrganizationAdministrationReceipt.organizationId,
  result_created_at: appOrganizationAdministrationReceipt.resultCreatedAt,
  result_status: appOrganizationAdministrationReceipt.resultStatus,
  result_updated_at: appOrganizationAdministrationReceipt.resultUpdatedAt,
  result_version: appOrganizationAdministrationReceipt.resultVersion,
  schema_version: appOrganizationAdministrationReceipt.schemaVersion,
  step_up_policy_id: appOrganizationAdministrationReceipt.stepUpPolicyId,
  step_up_policy_version:
    appOrganizationAdministrationReceipt.stepUpPolicyVersion,
};

const ensureTrustedAuthInvariant = (
  requestAuth: CurrentRequestAuthShape,
  principal: AuthPermission.PermissionSubject
) => {
  const { validated } = requestAuth;
  return validated.actor.sessionId === validated.currentSession.sessionId &&
    validated.actor.sessionId === validated.issued.sessionId &&
    validated.actor.userId === validated.currentSession.userId &&
    validated.actor.userId === validated.issued.userId &&
    principal.type === "user" &&
    principal.id === validated.actor.userId
    ? Effect.void
    : Effect.die(new Error("Current request auth contexts are inconsistent"));
};

const requireUnrestrictedSession = (
  requestAuth: CurrentRequestAuthShape,
  operation: OrganizationAdministrationOperation
) => {
  const { claims } = requestAuth.validated.currentSession;
  return (claims?.requirements?.length ?? 0) === 0 &&
    claims?.recoveryEnrollment === undefined &&
    claims?.recoveryRemediation === undefined
    ? Effect.void
    : Effect.fail(
        new OrganizationAdministrationError({
          message: "Session requirements must be completed first",
          operation,
          reason: "session-recheck",
        })
      );
};

const storageError = (
  operation: OrganizationAdministrationOperation,
  error: ControlPlane.ControlPlaneBatchError
) =>
  new OrganizationAdministrationError({
    cause: error.cause,
    commitState: error.commitState,
    message: "Organization lifecycle mutation failed",
    operation,
    reason: "storage",
  });

const auditError = (
  operation: "resume" | "suspend",
  error: AdministrativeAuditError
) =>
  new OrganizationAdministrationError({
    cause: error,
    commitState: "not-committed",
    message: "Failed to prepare organization audit",
    operation,
    reason: "storage",
  });

const decodeReceipt = (
  row: Schema.Schema.Type<typeof ReceiptRow>,
  operation: OrganizationAdministrationOperation
) =>
  Schema.decodeUnknownEffect(OrganizationAdministrationReceiptSchema)({
    actorUserId: row.actor_user_id,
    auditEventId: row.audit_event_id,
    committedAt: row.committed_at,
    expectedVersion: row.expected_version,
    matrixId: row.matrix_id,
    matrixVersion: row.matrix_version,
    operationId: row.operation_id,
    operationKind: row.operation_kind,
    organizationId: row.organization_id,
    result: {
      createdAt: row.result_created_at,
      id: row.organization_id,
      status: row.result_status,
      updatedAt: row.result_updated_at,
      version: row.result_version,
    },
    schemaVersion: row.schema_version,
    stepUpPolicyId: row.step_up_policy_id,
    stepUpPolicyVersion: row.step_up_policy_version,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new OrganizationAdministrationError({
          cause,
          commitState: "unknown",
          message: "Organization lifecycle receipt is invalid",
          operation,
          reason: "storage",
        })
    )
  );

const receiptMatches = (
  receipt: OrganizationAdministrationReceipt,
  input: ResumeCommand | SuspendCommand,
  operationKind: "resume" | "suspend"
) =>
  receipt.actorUserId.length > 0 &&
  receipt.operationKind === operationKind &&
  receipt.organizationId === input.organizationId &&
  receipt.expectedVersion === input.expectedVersion;

const OrganizationAdministrationTransactionD1Layer = Layer.effect(
  OrganizationAdministrationTransaction,
  Effect.gen(function* () {
    const audit = yield* AdministrativeAudit;
    const batch = yield* ControlPlane.ControlPlaneBatch;
    const database = yield* ControlPlaneDatabase;
    const runtime = yield* OrganizationAdministrationRuntime;
    const stepUpClock = yield* SensitiveOperationStepUpClock;

    const readReceipt = (
      operationId: string,
      actorUserId: string,
      operation: OrganizationAdministrationOperation
    ) =>
      database
        .select(receiptReturning)
        .from(appOrganizationAdministrationReceipt)
        .where(
          and(
            eq(appOrganizationAdministrationReceipt.operationId, operationId),
            eq(appOrganizationAdministrationReceipt.actorUserId, actorUserId)
          )
        )
        .limit(1)
        .pipe(
          Effect.mapError(
            (cause) =>
              new OrganizationAdministrationError({
                cause,
                message: "Organization lifecycle receipt read failed",
                operation,
                reason: "storage",
              })
          ),
          Effect.flatMap(([row]) =>
            row === undefined
              ? Effect.succeed(null)
              : Schema.decodeUnknownEffect(ReceiptRow)(row).pipe(
                  Effect.mapError(
                    (cause) =>
                      new OrganizationAdministrationError({
                        cause,
                        message: "Organization lifecycle receipt is invalid",
                        operation,
                        reason: "storage",
                      })
                  ),
                  Effect.flatMap((decoded) => decodeReceipt(decoded, operation))
                )
          )
        );

    // The branch count reflects explicit fail-closed denial classification.
    const mutate = (untrusted: unknown, operationKind: "resume" | "suspend") =>
      // oxlint-disable-next-line eslint/complexity
      Effect.gen(function* () {
        const operation = operationKind;
        const commandSchema =
          operationKind === "suspend"
            ? SuspendOrganizationCommand
            : ResumeOrganizationCommand;
        const input = yield* Schema.decodeUnknownEffect(commandSchema)(
          untrusted
        ).pipe(
          Effect.mapError(
            (cause) =>
              new OrganizationAdministrationError({
                cause,
                message: "Invalid organization lifecycle command",
                operation,
                reason: "invalid-input",
              })
          )
        );
        const requestAuth = yield* CurrentRequestAuth;
        const principal = yield* AuthPermission.CurrentPrincipal;
        yield* ensureTrustedAuthInvariant(requestAuth, principal);
        yield* requireUnrestrictedSession(requestAuth, operation);
        const replay = yield* readReceipt(
          input.operationId,
          requestAuth.validated.actor.userId,
          operation
        );
        if (replay !== null) {
          if (!receiptMatches(replay, input, operationKind)) {
            return yield* new OrganizationAdministrationError({
              message: "Operation ID was used for a different intent",
              operation,
              reason: "operation-conflict",
            });
          }
          return replay.result;
        }

        yield* requireSensitiveOperationStepUp(
          requestAuth.validated.currentSession,
          stepUpClock.now()
        ).pipe(
          Effect.mapError(
            (cause) =>
              new OrganizationAdministrationError({
                cause,
                message: "Recent authentication is required",
                operation,
                reason: "step-up-required",
              })
          )
        );

        const timestamp = Schema.decodeUnknownSync(UnixMillis)(runtime.now());
        const nonce = runtime.randomId();
        const transition = organizationLifecycleTransition(
          operationKind === "suspend"
            ? "organization.lifecycle.suspend"
            : "organization.lifecycle.resume"
        );
        if (transition === undefined) {
          return yield* Effect.die(
            new Error("Organization operation matrix is inconsistent")
          );
        }
        const { sourceStatus, targetStatus } = transition;
        const scope = organizationScope(
          makeOrganizationScopeId(input.organizationId)
        );
        const trustedSession = sensitiveSessionPredicate(
          database,
          requestAuth,
          timestamp
        );
        const trustedPermission = exactScopePermissionPredicate(
          database,
          principal,
          AuthorizationPermission.organizationManageSettings,
          scope
        );
        const trustedMembership = exists(
          database
            .select({ value: sql`1` })
            .from(appOrganizationMember)
            .where(
              and(
                eq(appOrganizationMember.organizationId, input.organizationId),
                eq(
                  appOrganizationMember.userId,
                  requestAuth.validated.actor.userId
                ),
                eq(appOrganizationMember.status, "active"),
                isNull(appOrganizationMember.suspendedAt),
                isNull(appOrganizationMember.revokedAt)
              )
            )
        );
        const organizationExists = exists(
          database
            .select({ value: sql`1` })
            .from(appOrganization)
            .where(eq(appOrganization.id, input.organizationId))
        );
        const organizationAtState = exists(
          database
            .select({ value: sql`1` })
            .from(appOrganization)
            .where(
              and(
                eq(appOrganization.id, input.organizationId),
                eq(appOrganization.status, sourceStatus),
                eq(appOrganization.version, input.expectedVersion)
              )
            )
        );
        const operationAvailable = notExists(
          database
            .select({ value: sql`1` })
            .from(appOrganizationAdministrationReceipt)
            .where(
              eq(
                appOrganizationAdministrationReceipt.operationId,
                input.operationId
              )
            )
        );
        const operationsDrained = notExists(
          database
            .select({ value: sql`1` })
            .from(appOrganizationOperationFence)
            .where(
              eq(
                appOrganizationOperationFence.organizationId,
                input.organizationId
              )
            )
        );
        const protocolActive = exists(
          database
            .select({ value: sql`1` })
            .from(appOrganizationLifecycleActivation)
            .where(
              and(
                eq(appOrganizationLifecycleActivation.id, 1),
                eq(appOrganizationLifecycleActivation.status, "active"),
                eq(appOrganizationLifecycleActivation.schemaVersion, 1)
              )
            )
        );
        const authorized = exists(
          database
            .select({ value: sql`1` })
            .from(appAuthorizationGuard)
            .where(eq(appAuthorizationGuard.nonce, nonce))
        );
        const auditEvent = yield* audit
          .prepare({
            _tag:
              operationKind === "suspend"
                ? "OrganizationSuspended"
                : "OrganizationResumed",
            beforeVersion: input.expectedVersion,
            occurredAt: timestamp,
            operationId: input.operationId,
            organizationId: input.organizationId,
          })
          .pipe(Effect.mapError((error) => auditError(operation, error)));

        const statements: ControlPlane.ControlPlaneStatements = [
          database.insert(appAuthorizationGuard).select(
            sql`select ${nonce}
                    where ${trustedSession}
                      and ${trustedMembership}
                      and ${trustedPermission}
                      and ${organizationAtState}
                      and ${operationsDrained}
                      and ${protocolActive}
                      and ${operationAvailable}`
          ),
          administrativeAuditInsertStatement(database, auditEvent, nonce),
          database
            .update(appOrganization)
            .set({
              status: targetStatus,
              updatedAt: timestamp,
              version: sql`${appOrganization.version} + 1`,
            })
            .where(
              and(
                eq(appOrganization.id, input.organizationId),
                eq(appOrganization.status, sourceStatus),
                eq(appOrganization.version, input.expectedVersion),
                authorized
              )
            )
            .returning({
              createdAt: appOrganization.createdAt,
              id: appOrganization.id,
              status: appOrganization.status,
              updatedAt: appOrganization.updatedAt,
              version: appOrganization.version,
            }),
          database
            .insert(appOrganizationAdministrationReceipt)
            .select(
              database
                .select({
                  actorUserId: sql`${requestAuth.validated.actor.userId}`.as(
                    "actor_user_id"
                  ),
                  auditEventId: sql`${auditEvent.eventId}`.as("audit_event_id"),
                  committedAt: appOrganization.updatedAt,
                  expectedVersion: sql`${input.expectedVersion}`.as(
                    "expected_version"
                  ),
                  matrixId: sql`${ORGANIZATION_OPERATION_MATRIX_ID}`.as(
                    "matrix_id"
                  ),
                  matrixVersion:
                    sql`${ORGANIZATION_OPERATION_MATRIX_VERSION}`.as(
                      "matrix_version"
                    ),
                  operationId: sql`${input.operationId}`.as("operation_id"),
                  operationKind: sql`${operationKind}`.as("operation_kind"),
                  organizationId: appOrganization.id,
                  resultCreatedAt: appOrganization.createdAt,
                  resultStatus: appOrganization.status,
                  resultUpdatedAt: appOrganization.updatedAt,
                  resultVersion: appOrganization.version,
                  schemaVersion: sql<1>`1`.as("schema_version"),
                  stepUpPolicyId: sql`${CONTROL_PLANE_STEP_UP_POLICY.id}`.as(
                    "step_up_policy_id"
                  ),
                  stepUpPolicyVersion:
                    sql`${CONTROL_PLANE_STEP_UP_POLICY.version}`.as(
                      "step_up_policy_version"
                    ),
                })
                .from(appOrganization)
                .where(
                  and(
                    eq(appOrganization.id, input.organizationId),
                    eq(appOrganization.status, targetStatus),
                    eq(appOrganization.version, input.expectedVersion + 1),
                    authorized
                  )
                )
            )
            .returning(receiptReturning),
          database.all(sql`select cast(${trustedSession} as integer)
                                    as session_valid,
                                 cast(${trustedMembership} as integer)
                                    as membership_valid,
                                 cast(${trustedPermission} as integer)
                                    as permission_valid,
                                 cast(${organizationExists} as integer)
                                    as organization_exists,
                                 cast(${organizationAtState} as integer)
                                    as state_valid,
                                 cast(${operationAvailable} as integer)
                                    as operation_available,
                                 cast(${operationsDrained} as integer)
                                    as operations_drained,
                                 cast(${protocolActive} as integer)
                                    as protocol_active,
                                 cast(${authorized} as integer) as authorized`),
          database
            .delete(appAuthorizationGuard)
            .where(eq(appAuthorizationGuard.nonce, nonce)),
        ];

        const results = yield* batch.execute(statements).pipe(
          Effect.catchTag("ControlPlaneBatchError", (error) =>
            error.commitState === "unknown"
              ? readReceipt(
                  input.operationId,
                  requestAuth.validated.actor.userId,
                  operation
                ).pipe(
                  Effect.flatMap((receipt) =>
                    receipt === null
                      ? Effect.fail(storageError(operation, error))
                      : receiptMatches(receipt, input, operationKind)
                        ? Effect.succeed(receipt)
                        : Effect.fail(
                            new OrganizationAdministrationError({
                              message:
                                "Operation ID was used for a different intent",
                              operation,
                              reason: "operation-conflict",
                            })
                          )
                  )
                )
              : Effect.fail(storageError(operation, error))
          )
        );
        if (results instanceof OrganizationAdministrationReceipt) {
          return results.result;
        }

        const statusRows = yield* Schema.decodeUnknownEffect(
          Schema.Array(LifecycleStatusRow)
        )(results[4]?.results).pipe(
          Effect.mapError(
            (cause) =>
              new OrganizationAdministrationError({
                cause,
                commitState: "unknown",
                message: "Organization lifecycle status is invalid",
                operation,
                reason: "storage",
              })
          )
        );
        const [status] = statusRows;
        if (status?.authorized !== 1) {
          if (status?.session_valid !== 1) {
            return yield* new OrganizationAdministrationError({
              message: "Session changed before organization mutation",
              operation,
              reason: "session-recheck",
            });
          }
          if (status.membership_valid !== 1) {
            return yield* new OrganizationAdministrationError({
              message: "Active organization membership is required",
              operation,
              reason: "membership-recheck",
            });
          }
          if (status.operation_available !== 1) {
            const concurrent = yield* readReceipt(
              input.operationId,
              requestAuth.validated.actor.userId,
              operation
            );
            if (
              concurrent !== null &&
              receiptMatches(concurrent, input, operationKind)
            ) {
              return concurrent.result;
            }
            return yield* new OrganizationAdministrationError({
              message: "Operation ID was used for a different intent",
              operation,
              reason: "operation-conflict",
            });
          }
          if (status.organization_exists !== 1) {
            return yield* new OrganizationAdministrationError({
              message: "Organization not found",
              operation,
              reason: "not-found",
            });
          }
          if (status.state_valid !== 1) {
            return yield* new OrganizationAdministrationError({
              message: "Organization lifecycle state changed",
              operation,
              reason: "conflict",
            });
          }
          if (status.operations_drained !== 1) {
            return yield* new OrganizationAdministrationError({
              message: "Organization operations are still in flight",
              operation,
              reason: "conflict",
            });
          }
          if (status.protocol_active !== 1) {
            return yield* new OrganizationAdministrationError({
              message: "Organization lifecycle protocol is not active",
              operation,
              reason: "conflict",
            });
          }
          return yield* new OrganizationAdministrationError({
            message: "Permission changed before organization mutation",
            operation,
            permission: AuthorizationPermission.organizationManageSettings,
            reason: "authorization-recheck",
            scope,
          });
        }

        const receiptRows = yield* Schema.decodeUnknownEffect(
          Schema.Array(ReceiptRow)
        )(results[3]?.results).pipe(
          Effect.mapError(
            (cause) =>
              new OrganizationAdministrationError({
                cause,
                commitState: "committed",
                message: "Organization lifecycle receipt is invalid",
                operation,
                reason: "storage",
              })
          )
        );
        const [receiptRow] = receiptRows;
        if (receiptRow === undefined) {
          return yield* new OrganizationAdministrationError({
            commitState: "committed",
            message: "Organization lifecycle receipt was missing",
            operation,
            reason: "storage",
          });
        }
        return (yield* decodeReceipt(receiptRow, operation)).result;
      });

    return OrganizationAdministrationTransaction.of({
      readOperation: (untrusted: unknown) =>
        Effect.gen(function* () {
          const input = yield* Schema.decodeUnknownEffect(
            ReadOrganizationAdministrationOperationQuery
          )(untrusted).pipe(
            Effect.mapError(
              (cause) =>
                new OrganizationAdministrationError({
                  cause,
                  message: "Invalid organization operation query",
                  operation: "read-operation",
                  reason: "invalid-input",
                })
            )
          );
          const requestAuth = yield* CurrentRequestAuth;
          const principal = yield* AuthPermission.CurrentPrincipal;
          yield* ensureTrustedAuthInvariant(requestAuth, principal);
          yield* requireUnrestrictedSession(requestAuth, "read-operation");
          const receipt = yield* readReceipt(
            input.operationId,
            requestAuth.validated.actor.userId,
            "read-operation"
          );
          if (receipt === null) {
            return yield* new OrganizationAdministrationError({
              message: "Organization operation receipt not found",
              operation: "read-operation",
              reason: "not-found",
            });
          }
          return receipt;
        }),
      resume: (input) => mutate(input, "resume"),
      suspend: (input) => mutate(input, "suspend"),
    });
  })
);

export const OrganizationAdministrationD1Layer =
  OrganizationAdministration.layerNoDeps.pipe(
    Layer.provide(OrganizationAdministrationTransactionD1Layer)
  );
