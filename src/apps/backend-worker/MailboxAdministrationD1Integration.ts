import * as AuthPermission from "@effect-auth/core/Permission";
import {
  and,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  notExists,
  sql,
} from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { authUserIdentity } from "#/auth/schema/modules/core";
import { authPasskeyCredential } from "#/auth/schema/modules/passkeys";
import {
  authRoleDefinition,
  authRoleGrant,
} from "#/auth/schema/modules/permissions";
import { authRecoveryCode } from "#/auth/schema/modules/recovery-codes";
import {
  appExternalRecoveryIdentity,
  appFirstOwnerPasswordEnrollment,
  appPasskeyEnrollmentReceipt,
  appRecoveryCodeRotationReceipt,
} from "#/modules/account-security/adapters/d1/AccountSecuritySchema";
import { requireSensitiveOperationStepUp } from "#/modules/account-security/domain/StepUpPolicy";
import {
  sensitiveSessionPredicate,
  transactionalSessionPredicate,
} from "#/modules/account-security/integration/AccountSecurityD1RequestGuard";
import { SensitiveOperationStepUpClock } from "#/modules/account-security/ports/SensitiveOperationStepUpClock";
import { primaryMailboxAddressInsertStatement } from "#/modules/address-routing/integration/AddressRoutingD1Statements";
import { AdministrativeAudit } from "#/modules/administrative-audit/contracts/AdministrativeAudit";
import type { AdministrativeAuditError } from "#/modules/administrative-audit/contracts/AdministrativeAuditError";
import { administrativeAuditInsertStatement } from "#/modules/administrative-audit/integration/AdministrativeAuditD1Statements";
import {
  AuthorizationPermission,
  LegacyMailboxRole,
  makeMailboxScopeId,
  mailboxScope,
} from "#/modules/authorization/contracts/AuthorizationCatalog";
import { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import { MailboxAuthorization } from "#/modules/mailbox/ports/MailboxAuthorization";
import {
  appMailbox,
  appMailboxAdministrationReceipt,
  appMailboxBootstrapDomainIntent,
  appMailboxBootstrapReceiptV1Intent,
  appMailboxBootstrapReceiptV2,
  appMailboxBootstrapSecurityIntent,
  appMailboxMember,
} from "#/modules/organization/adapters/d1/OrganizationSchema";
import {
  MailboxAdministration,
  MailboxAdministrationError,
  MailboxAdministrationReceipt,
  MailboxAdministrationReceiptSchema,
  ReadMailboxAdministrationOperationQuery,
  RenameMailboxCommand,
} from "#/modules/organization/application/MailboxAdministration";
import { OrganizationBootstrap } from "#/modules/organization/application/OrganizationBootstrap";
import type { MailboxBootstrapConfigValue } from "#/modules/organization/contracts/MailboxBootstrapConfig";
import { MailboxBootstrapConfig } from "#/modules/organization/contracts/MailboxBootstrapConfig";
import { MailboxDisplayName } from "#/modules/organization/domain/Mailbox";
import {
  MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID,
  MAIL_DOMAIN_CANONICALIZATION_VERSION,
} from "#/modules/organization/domain/MailDomain";
import { LEGACY_DEFAULT_ORGANIZATION_ID } from "#/modules/organization/domain/Organization";
import { canonicalMailboxAncestryPredicate } from "#/modules/organization/integration/OrganizationD1Predicates";
import { legacyDefaultOrganizationBootstrapInsertStatement } from "#/modules/organization/integration/OrganizationD1Statements";
import { MailboxAdministrationTransaction } from "#/modules/organization/ports/MailboxAdministrationTransaction";
import {
  OrganizationBootstrapTransaction,
  TrustedBootstrapOrganizationCommand,
} from "#/modules/organization/ports/OrganizationBootstrapTransaction";
import { appAuthorizationGuard } from "#/platform/control-plane-d1/AuthorizationGuardSchema";
import * as ControlPlane from "#/platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import { permissionPredicate } from "#/platform/control-plane-d1/PermissionGuard";
import { controlPlaneDatabaseNow } from "#/platform/control-plane-d1/RequestAuthGuard";
import {
  NormalizedEmailAddress,
  normalizeEmailAddressDomain,
} from "#/shared/EmailAddress";
import { CurrentRequestAuth } from "#/shared/RequestAuth";
import type { CurrentRequestAuthShape } from "#/shared/RequestAuth";
import { UnixMillis } from "#/shared/Temporal";

export interface MailboxAdministrationRuntime {
  readonly now: () => number;
  readonly randomId: () => string;
}

/** Clock and identifier source captured by mailbox administration. */
export const MailboxAdministrationRuntime =
  Context.Service<MailboxAdministrationRuntime>(
    "cloudflare-inbox/MailboxAdministrationRuntime"
  );

export const MailboxAdministrationRuntimeLayer = Layer.succeed(
  MailboxAdministrationRuntime,
  MailboxAdministrationRuntime.of({
    now: Date.now,
    randomId: () => crypto.randomUUID(),
  })
);

const activeOwnerRolePredicate = (database: ControlPlaneDatabase) =>
  exists(
    database
      .select({ value: sql`1` })
      .from(authRoleDefinition)
      .where(
        and(
          eq(authRoleDefinition.id, LegacyMailboxRole.owner),
          isNull(authRoleDefinition.disabledAt),
          isNull(authRoleDefinition.deletedAt)
        )
      )
  );

const ownerIdentityPredicate = (
  database: ControlPlaneDatabase,
  userId: string,
  normalizedEmails: readonly string[]
) =>
  exists(
    database
      .select({ value: sql`1` })
      .from(authUserIdentity)
      .where(
        and(
          eq(authUserIdentity.userId, userId),
          eq(authUserIdentity.scopeType, "global"),
          inArray(authUserIdentity.scopeId, ["", "global"]),
          eq(authUserIdentity.kind, "email"),
          inArray(authUserIdentity.normalizedValue, normalizedEmails),
          isNotNull(authUserIdentity.verifiedAt),
          isNull(authUserIdentity.revokedAt),
          isNull(authUserIdentity.replacedById)
        )
      )
  );

const ensureTrustedAuthInvariant = (
  requestAuth: CurrentRequestAuthShape,
  principal?: AuthPermission.PermissionSubject
) => {
  const { validated } = requestAuth;
  const validSession =
    validated.actor.sessionId === validated.currentSession.sessionId &&
    validated.actor.sessionId === validated.issued.sessionId &&
    validated.actor.userId === validated.currentSession.userId &&
    validated.actor.userId === validated.issued.userId;
  const validPrincipal =
    principal === undefined ||
    (principal.type === "user" && principal.id === validated.actor.userId);

  return validSession && validPrincipal
    ? Effect.void
    : Effect.die(new Error("Current request auth contexts are inconsistent"));
};

const requireUnrestrictedSession = (
  requestAuth: CurrentRequestAuthShape,
  operation: MailboxAdministrationError["operation"]
) =>
  (requestAuth.validated.currentSession.claims?.requirements?.length ?? 0) === 0
    ? Effect.void
    : Effect.fail(
        new MailboxAdministrationError({
          message: "Session requirements must be completed first",
          operation,
          reason: "session-recheck",
        })
      );

const validateDisplayName = (
  displayName: unknown,
  operation: "bootstrap-owner" | "rename"
) =>
  Schema.decodeUnknownEffect(MailboxDisplayName)(displayName).pipe(
    Effect.mapError(
      () =>
        new MailboxAdministrationError({
          message: "Mailbox display name must contain 1 to 200 characters",
          operation,
          reason: "invalid-input",
        })
    )
  );

const requireConfiguredBootstrapValues = (
  input: Schema.Schema.Type<typeof TrustedBootstrapOrganizationCommand>,
  config: MailboxBootstrapConfigValue
) =>
  input.initialAddress === config.initialAddress &&
  input.initialDomain === config.initialDomain &&
  input.ownerEmailAllowlist.length === config.ownerEmailAllowlist.length &&
  input.ownerEmailAllowlist.every(
    (address, index) => address === config.ownerEmailAllowlist[index]
  )
    ? Effect.void
    : Effect.fail(
        new MailboxAdministrationError({
          message: "Trusted bootstrap address does not match configuration",
          operation: "bootstrap-owner",
          reason: "invalid-input",
        })
      );

const storageError = (
  operation: "bootstrap-owner" | "rename",
  error: ControlPlane.ControlPlaneBatchError
) =>
  new MailboxAdministrationError({
    cause: error.cause,
    commitState: error.commitState,
    message: "Control-plane mutation failed",
    operation,
    reason: "storage",
  });

const auditError = (
  operation: "bootstrap-owner" | "rename",
  error: AdministrativeAuditError
) =>
  new MailboxAdministrationError({
    cause: error,
    commitState: "not-committed",
    message: "Failed to prepare administrative audit",
    operation,
    reason: "storage",
  });

const decodeResultRows = <Row>(
  schema: Schema.Decoder<Row>,
  results: readonly ControlPlane.ControlPlaneBatchResult[],
  statement: number,
  operation: "bootstrap-owner" | "rename"
) =>
  Schema.decodeUnknownEffect(Schema.Array(schema))(
    results[statement]?.results
  ).pipe(
    Effect.mapError(
      (cause) =>
        new MailboxAdministrationError({
          cause,
          commitState: "unknown",
          message: "Control-plane returned invalid mutation data",
          operation,
          reason: "storage",
        })
    )
  );

const BootstrapStatusRow = Schema.Struct({
  authorized: Schema.Number,
  base_session_valid: Schema.Number,
  catalog_valid: Schema.Number,
  recovery_ready: Schema.Number,
  recovery_codes_ready: Schema.Number,
  mailbox_available: Schema.Number,
  operation_available: Schema.Number,
  owner_eligible: Schema.Number,
  passkeys_ready: Schema.Number,
  seal_actor_valid: Schema.Number,
  step_up_valid: Schema.Number,
});

const RenameStatusRow = Schema.Struct({
  authorized: Schema.Number,
  mailbox_exists: Schema.Number,
  operation_available: Schema.Number,
  permission_valid: Schema.Number,
  session_valid: Schema.Number,
  version_valid: Schema.Number,
});

const RenamedMailboxRow = Schema.Struct({
  created_at: Schema.Number,
  created_by_user_id: Schema.String,
  display_name: Schema.String,
  id: Schema.String,
  updated_at: Schema.Number,
  version: Schema.Number,
});

const CreatedMailboxRow = Schema.Struct({ id: Schema.String });

const ReceiptRow = Schema.Struct({
  actor_user_id: Schema.String,
  committed_at: Schema.Number,
  display_name: Schema.String,
  expected_version: Schema.NullOr(Schema.Number),
  mailbox_id: Schema.String,
  operation_id: Schema.String,
  operation_kind: Schema.Literals(["bootstrap-owner", "rename"]),
  result_created_at: Schema.Number,
  result_created_by_user_id: Schema.String,
  result_display_name: Schema.String,
  result_mailbox_id: Schema.String,
  result_status: Schema.Literal("active"),
  result_updated_at: Schema.Number,
  result_version: Schema.Number,
  schema_version: Schema.Literal(1),
});

const ReadReceiptRow = Schema.Struct({
  ...ReceiptRow.fields,
  ancestry_valid: Schema.Literal(1),
  bootstrap_initial_address: Schema.NullOr(Schema.String),
  bootstrap_schema_version: Schema.NullOr(Schema.Literal(2)),
  legacy_initial_address: Schema.NullOr(Schema.String),
}).check(
  Schema.makeFilter((row) => {
    const hasLegacyIntent = row.legacy_initial_address !== null;
    const hasV2Intent = row.bootstrap_initial_address !== null;
    const v2PairValid = hasV2Intent === (row.bootstrap_schema_version !== null);
    const intentSourcesValid =
      row.operation_kind === "bootstrap-owner"
        ? hasLegacyIntent !== hasV2Intent
        : !hasLegacyIntent && !hasV2Intent;
    return row.ancestry_valid && v2PairValid && intentSourcesValid
      ? undefined
      : "mailbox bootstrap receipt intent source is inconsistent";
  })
);

const BootstrapReceiptV2Row = Schema.Struct({
  initial_address: Schema.String,
  operation_id: Schema.String,
  schema_version: Schema.Literal(2),
});

const decodeReceipt = (
  row: Schema.Schema.Type<typeof ReceiptRow>,
  operation: MailboxAdministrationError["operation"],
  initialAddress?: string
) =>
  Schema.decodeUnknownEffect(MailboxAdministrationReceiptSchema)({
    actorUserId: row.actor_user_id,
    committedAt: row.committed_at,
    displayName: row.display_name,
    ...(row.expected_version === null
      ? {}
      : { expectedVersion: row.expected_version }),
    mailboxId: row.mailbox_id,
    operationId: row.operation_id,
    operationKind: row.operation_kind,
    ...(initialAddress === undefined ? {} : { initialAddress }),
    result: {
      createdAt: row.result_created_at,
      createdByUserId: row.result_created_by_user_id,
      displayName: row.result_display_name,
      id: row.result_mailbox_id,
      status: row.result_status,
      updatedAt: row.result_updated_at,
      version: row.result_version,
    },
    schemaVersion: initialAddress === undefined ? row.schema_version : 2,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new MailboxAdministrationError({
          cause,
          message: "Stored mailbox operation receipt was invalid",
          operation,
          reason: "storage",
        })
    )
  );

const receiptMatches = (
  receipt: MailboxAdministrationReceipt,
  intent: {
    readonly acknowledgedRecoveryCodeRotationOperationId?: string;
    readonly displayName: string;
    readonly expectedVersion?: number;
    readonly initialAddress?: string;
    readonly mailboxId: string;
    readonly operationKind: "bootstrap-owner" | "rename";
  }
) =>
  receipt.operationKind === intent.operationKind &&
  receipt.mailboxId === intent.mailboxId &&
  receipt.displayName === intent.displayName &&
  receipt.expectedVersion === intent.expectedVersion &&
  (receipt.schemaVersion === 1 ||
    receipt.initialAddress === intent.initialAddress);

/** Transactional bootstrap and mailbox administration built from one D1 assembly. */
const OrganizationTransactionsD1Layer = Layer.effectContext(
  Effect.gen(function* () {
    const bootstrapConfig = yield* MailboxBootstrapConfig;
    const runtime = yield* MailboxAdministrationRuntime;
    const stepUpClock = yield* SensitiveOperationStepUpClock;
    const batch = yield* ControlPlane.ControlPlaneBatch;
    const database = yield* ControlPlaneDatabase;
    const authorization = yield* MailboxAuthorization;
    const audit = yield* AdministrativeAudit;
    const { now, randomId } = runtime;

    const readHistoricalBootstrapIntent = (
      operationId: string,
      operation: MailboxAdministrationError["operation"]
    ) =>
      database
        .select({
          initialAddress: appMailboxBootstrapReceiptV1Intent.initialAddress,
        })
        .from(appMailboxBootstrapReceiptV1Intent)
        .where(eq(appMailboxBootstrapReceiptV1Intent.operationId, operationId))
        .limit(2)
        .pipe(
          Effect.mapError(
            (cause) =>
              new MailboxAdministrationError({
                cause,
                message: "Historical bootstrap intent read failed",
                operation,
                reason: "storage",
              })
          ),
          Effect.flatMap((rows) => {
            if (rows.length !== 1) {
              return Effect.fail(
                new MailboxAdministrationError({
                  message: "Historical bootstrap intent marker is missing",
                  operation,
                  reason: "storage",
                })
              );
            }
            const [row] = rows;
            return Schema.decodeUnknownEffect(NormalizedEmailAddress)(
              row?.initialAddress
            ).pipe(
              Effect.filterOrFail(
                (initialAddress) => initialAddress === row?.initialAddress,
                () => new Error("Historical bootstrap intent is malformed")
              ),
              Effect.mapError(
                (cause) =>
                  new MailboxAdministrationError({
                    cause,
                    message: "Historical bootstrap intent marker is invalid",
                    operation,
                    reason: "storage",
                  })
              )
            );
          })
        );

    const readReceipt = (
      operationId: string,
      actorUserId: string,
      operation: MailboxAdministrationError["operation"]
    ) =>
      database
        .select({
          ancestry_valid: canonicalMailboxAncestryPredicate(
            database,
            appMailboxAdministrationReceipt.mailboxId
          ),
          actor_user_id: appMailboxAdministrationReceipt.actorUserId,
          committed_at: appMailboxAdministrationReceipt.committedAt,
          display_name: appMailboxAdministrationReceipt.displayName,
          expected_version: appMailboxAdministrationReceipt.expectedVersion,
          mailbox_id: appMailboxAdministrationReceipt.mailboxId,
          operation_id: appMailboxAdministrationReceipt.operationId,
          operation_kind: appMailboxAdministrationReceipt.operationKind,
          result_created_at: appMailboxAdministrationReceipt.resultCreatedAt,
          result_created_by_user_id:
            appMailboxAdministrationReceipt.resultCreatedByUserId,
          result_display_name:
            appMailboxAdministrationReceipt.resultDisplayName,
          result_mailbox_id: appMailboxAdministrationReceipt.resultMailboxId,
          result_status: appMailboxAdministrationReceipt.resultStatus,
          result_updated_at: appMailboxAdministrationReceipt.resultUpdatedAt,
          result_version: appMailboxAdministrationReceipt.resultVersion,
          schema_version: appMailboxAdministrationReceipt.schemaVersion,
          bootstrap_initial_address: sql<
            string | null
          >`${appMailboxBootstrapReceiptV2.initialAddress}`.as(
            "bootstrap_initial_address"
          ),
          bootstrap_schema_version: sql<
            2 | null
          >`${appMailboxBootstrapReceiptV2.schemaVersion}`.as(
            "bootstrap_schema_version"
          ),
          legacy_initial_address: sql<
            string | null
          >`${appMailboxBootstrapReceiptV1Intent.initialAddress}`.as(
            "legacy_initial_address"
          ),
        })
        .from(appMailboxAdministrationReceipt)
        .leftJoin(
          appMailboxBootstrapReceiptV1Intent,
          eq(
            appMailboxBootstrapReceiptV1Intent.operationId,
            appMailboxAdministrationReceipt.operationId
          )
        )
        .leftJoin(
          appMailboxBootstrapReceiptV2,
          eq(
            appMailboxBootstrapReceiptV2.operationId,
            appMailboxAdministrationReceipt.operationId
          )
        )
        .where(
          and(
            eq(appMailboxAdministrationReceipt.operationId, operationId),
            eq(appMailboxAdministrationReceipt.actorUserId, actorUserId)
          )
        )
        .limit(1)
        .pipe(
          Effect.mapError(
            (cause) =>
              new MailboxAdministrationError({
                cause,
                message: "Mailbox operation receipt read failed",
                operation,
                reason: "storage",
              })
          ),
          Effect.flatMap(([row]) =>
            row === undefined
              ? Effect.succeed(null)
              : Schema.decodeUnknownEffect(ReadReceiptRow)(row).pipe(
                  Effect.mapError(
                    (cause) =>
                      new MailboxAdministrationError({
                        cause,
                        message: "Stored mailbox operation receipt was invalid",
                        operation,
                        reason: "storage",
                      })
                  ),
                  Effect.flatMap((decoded) =>
                    decodeReceipt(
                      decoded,
                      operation,
                      decoded.bootstrap_initial_address ?? undefined
                    )
                  )
                )
          )
        );

    const readCurrentSecurityIntent = (
      operationId: string,
      operation: MailboxAdministrationError["operation"]
    ) =>
      database
        .select({
          recoveryRotationOperationId:
            appMailboxBootstrapSecurityIntent.recoveryRotationOperationId,
        })
        .from(appMailboxBootstrapSecurityIntent)
        .where(eq(appMailboxBootstrapSecurityIntent.operationId, operationId))
        .limit(2)
        .pipe(
          Effect.mapError(
            (cause) =>
              new MailboxAdministrationError({
                cause,
                message: "Bootstrap security intent read failed",
                operation,
                reason: "storage",
              })
          ),
          Effect.flatMap((rows) =>
            rows.length > 1
              ? Effect.fail(
                  new MailboxAdministrationError({
                    message: "Stored bootstrap security intent was invalid",
                    operation,
                    reason: "storage",
                  })
                )
              : Effect.succeed(rows[0]?.recoveryRotationOperationId)
          )
        );

    const receiptMatchesIntent = (
      receipt: MailboxAdministrationReceipt,
      intent: Parameters<typeof receiptMatches>[1],
      operation: MailboxAdministrationError["operation"]
    ) =>
      receipt.schemaVersion === 1 &&
      receipt.operationKind === "bootstrap-owner" &&
      intent.operationKind === "bootstrap-owner"
        ? readHistoricalBootstrapIntent(receipt.operationId, operation).pipe(
            Effect.map(
              (historicalInitialAddress) =>
                receiptMatches(receipt, intent) &&
                historicalInitialAddress === intent.initialAddress
            )
          )
        : readCurrentSecurityIntent(receipt.operationId, operation).pipe(
            Effect.map(
              (storedAcknowledgement) =>
                receiptMatches(receipt, intent) &&
                (storedAcknowledgement === undefined ||
                  storedAcknowledgement ===
                    intent.acknowledgedRecoveryCodeRotationOperationId)
            )
          );

    const receiptReturning = {
      actor_user_id: appMailboxAdministrationReceipt.actorUserId,
      committed_at: appMailboxAdministrationReceipt.committedAt,
      display_name: appMailboxAdministrationReceipt.displayName,
      expected_version: appMailboxAdministrationReceipt.expectedVersion,
      mailbox_id: appMailboxAdministrationReceipt.mailboxId,
      operation_id: appMailboxAdministrationReceipt.operationId,
      operation_kind: appMailboxAdministrationReceipt.operationKind,
      result_created_at: appMailboxAdministrationReceipt.resultCreatedAt,
      result_created_by_user_id:
        appMailboxAdministrationReceipt.resultCreatedByUserId,
      result_display_name: appMailboxAdministrationReceipt.resultDisplayName,
      result_mailbox_id: appMailboxAdministrationReceipt.resultMailboxId,
      result_status: appMailboxAdministrationReceipt.resultStatus,
      result_updated_at: appMailboxAdministrationReceipt.resultUpdatedAt,
      result_version: appMailboxAdministrationReceipt.resultVersion,
      schema_version: appMailboxAdministrationReceipt.schemaVersion,
    } as const;

    const services = {
      bootstrap: (untrusted: unknown) =>
        // oxlint-disable-next-line eslint/complexity -- Bootstrap maps every transactional guard to a distinct typed failure.
        Effect.gen(function* () {
          const input = yield* Schema.decodeUnknownEffect(
            TrustedBootstrapOrganizationCommand
          )(untrusted).pipe(
            Effect.mapError(
              (cause) =>
                new MailboxAdministrationError({
                  cause,
                  message: "Invalid owner bootstrap command",
                  operation: "bootstrap-owner",
                  reason: "invalid-input",
                })
            )
          );
          yield* requireConfiguredBootstrapValues(input, bootstrapConfig);
          const requestAuth = yield* CurrentRequestAuth;
          const { validated } = requestAuth;
          yield* ensureTrustedAuthInvariant(requestAuth);
          yield* requireUnrestrictedSession(requestAuth, "bootstrap-owner");
          const mailboxId = Schema.decodeUnknownSync(MailboxId)("primary");
          const replay = yield* readReceipt(
            input.operationId,
            validated.actor.userId,
            "bootstrap-owner"
          );
          if (replay !== null) {
            const matches = yield* receiptMatchesIntent(
              replay,
              {
                displayName: input.displayName,
                acknowledgedRecoveryCodeRotationOperationId:
                  input.acknowledgedRecoveryCodeRotationOperationId,
                initialAddress: input.initialAddress,
                mailboxId,
                operationKind: "bootstrap-owner",
              },
              "bootstrap-owner"
            );
            if (!matches) {
              return yield* new MailboxAdministrationError({
                message: "Operation ID was used for a different intent",
                operation: "bootstrap-owner",
                reason: "operation-conflict",
              });
            }
            return replay.result;
          }
          const stepUpTimestamp = stepUpClock.now();
          yield* requireSensitiveOperationStepUp(
            validated.currentSession,
            stepUpTimestamp
          ).pipe(
            Effect.mapError(
              (error) =>
                new MailboxAdministrationError({
                  cause: error,
                  message: "Recent authentication is required",
                  operation: "bootstrap-owner",
                  reason: "step-up-required",
                })
            )
          );
          const displayName = yield* validateDisplayName(
            input.displayName,
            "bootstrap-owner"
          );
          const acknowledgedRotationOperationId =
            input.acknowledgedRecoveryCodeRotationOperationId ?? "";
          const timestamp = Schema.decodeUnknownSync(UnixMillis)(now());
          const nonce = randomId();
          const auditEvent = yield* audit
            .prepare({
              _tag: "MailboxBootstrapped",
              mailboxId,
              occurredAt: timestamp,
              operationId: input.operationId,
            })
            .pipe(
              Effect.mapError((error) => auditError("bootstrap-owner", error))
            );
          const trustedSession = sensitiveSessionPredicate(
            database,
            requestAuth,
            timestamp
          );
          const trustedBaseSession = transactionalSessionPredicate(
            database,
            requestAuth,
            timestamp
          );
          const ownerRoleActive = activeOwnerRolePredicate(database);
          const ownerIdentityValid = ownerIdentityPredicate(
            database,
            validated.actor.userId,
            input.ownerEmailAllowlist
          );
          // A committed replay returned above is deliberately independent of current
          // credentials. Every new current-schema bootstrap is sealed to its actor.
          const sealActorValid = exists(
            database
              .select({ value: sql`1` })
              .from(appFirstOwnerPasswordEnrollment)
              .where(
                and(
                  eq(appFirstOwnerPasswordEnrollment.singletonKey, 1),
                  eq(
                    appFirstOwnerPasswordEnrollment.actorUserId,
                    validated.actor.userId
                  ),
                  sql`${appFirstOwnerPasswordEnrollment.committedAt}
                    <= ${controlPlaneDatabaseNow}`
                )
              )
          );
          const recoveryReady = sql`(
            select count(*) from ${appExternalRecoveryIdentity}
             where ${appExternalRecoveryIdentity.userId} = ${validated.actor.userId}
               and ${appExternalRecoveryIdentity.status} = 'verified'
               and ${appExternalRecoveryIdentity.verifiedAt} is not null
               and ${appExternalRecoveryIdentity.verifiedAt} <= ${controlPlaneDatabaseNow}
               and ${appExternalRecoveryIdentity.revokedAt} is null
          ) = 1`;
          const passkeysReady = sql`(
            select count(*)
              from ${authPasskeyCredential} credential
              join ${appPasskeyEnrollmentReceipt} receipt
                on receipt.${sql.identifier("credential_record_id")} = credential.${sql.identifier("id")}
               and receipt.${sql.identifier("actor_user_id")} = credential.${sql.identifier("user_id")}
               and receipt.${sql.identifier("committed_at")} = credential.${sql.identifier("created_at")}
             where credential.${sql.identifier("user_id")} = ${validated.actor.userId}
               and credential.${sql.identifier("revoked_at")} is null
               and credential.${sql.identifier("created_at")} <= ${controlPlaneDatabaseNow}
          ) >= 2`;
          const acknowledgedRotationMatches =
            input.acknowledgedRecoveryCodeRotationOperationId === undefined
              ? sql`0`
              : eq(
                  appRecoveryCodeRotationReceipt.operationId,
                  acknowledgedRotationOperationId
                );
          const recoveryCodesReady = exists(
            database
              .select({ value: sql`1` })
              .from(appRecoveryCodeRotationReceipt)
              .where(
                and(
                  eq(
                    appRecoveryCodeRotationReceipt.userId,
                    validated.actor.userId
                  ),
                  acknowledgedRotationMatches,
                  eq(appRecoveryCodeRotationReceipt.codeCount, 10),
                  sql`${appRecoveryCodeRotationReceipt.generatedAt}
                    <= ${controlPlaneDatabaseNow}`,
                  sql`${appRecoveryCodeRotationReceipt.committedAt}
                    <= ${controlPlaneDatabaseNow}`,
                  sql`(
                    select count(*) from ${authRecoveryCode} code
                     where code.${sql.identifier("user_id")} = ${validated.actor.userId}
                       and code.${sql.identifier("used_at")} is null
                       and code.${sql.identifier("revoked_at")} is null
                  ) = 10`,
                  sql`(
                    select count(*) from ${authRecoveryCode} code
                     where code.${sql.identifier("user_id")} = ${validated.actor.userId}
                       and code.${sql.identifier("used_at")} is null
                       and code.${sql.identifier("revoked_at")} is null
                       and code.${sql.identifier("created_at")} = ${appRecoveryCodeRotationReceipt.generatedAt}
                       and code.${sql.identifier("metadata")} = json_object(
                         'setId', ${appRecoveryCodeRotationReceipt.resultingSetId})
                  ) = 10`
                )
              )
          );
          const mailboxAvailable = notExists(
            database.select({ value: sql`1` }).from(appMailbox)
          );
          const operationAvailable = notExists(
            database
              .select({ value: sql`1` })
              .from(appMailboxAdministrationReceipt)
              .where(
                eq(
                  appMailboxAdministrationReceipt.operationId,
                  input.operationId
                )
              )
          );
          const authorized = exists(
            database
              .select({ value: sql`1` })
              .from(appAuthorizationGuard)
              .where(eq(appAuthorizationGuard.nonce, nonce))
          );
          const createdMailbox = and(
            eq(appMailbox.id, mailboxId),
            eq(appMailbox.createdByUserId, validated.actor.userId),
            eq(appMailbox.createdAt, timestamp),
            canonicalMailboxAncestryPredicate(database, appMailbox.id)
          );
          const mailboxCreated = exists(
            database
              .select({ value: sql`1` })
              .from(appMailbox)
              .where(createdMailbox)
          );
          const statements: ControlPlane.ControlPlaneStatements = [
            database.insert(appAuthorizationGuard).select(
              sql`select ${nonce}
                      where ${trustedSession}
                        and ${ownerRoleActive}
                        and ${ownerIdentityValid}
                        and ${sealActorValid}
                        and ${recoveryReady}
                        and ${passkeysReady}
                        and ${recoveryCodesReady}
                        and ${mailboxAvailable}
                        and ${operationAvailable}`
            ),
            database.all(sql`select cast(${trustedBaseSession} as integer)
                                      as base_session_valid,
                                   cast(${trustedSession} as integer)
                                      as step_up_valid,
                                   cast(${ownerRoleActive} as integer)
                                      as catalog_valid,
                                    cast(${ownerIdentityValid} as integer)
                                       as owner_eligible,
                                    cast(${sealActorValid} as integer)
                                       as seal_actor_valid,
                                    cast(${recoveryReady} as integer)
                                       as recovery_ready,
                                    cast(${passkeysReady} as integer)
                                       as passkeys_ready,
                                    cast(${recoveryCodesReady} as integer)
                                       as recovery_codes_ready,
                                   cast(${mailboxAvailable} as integer)
                                      as mailbox_available,
                                    cast(${operationAvailable} as integer)
                                       as operation_available,
                                    cast(${authorized} as integer) as authorized`),
            legacyDefaultOrganizationBootstrapInsertStatement(database, {
              authorizationGuardNonce: nonce,
              createdAt: timestamp,
            }),
            database
              .insert(appMailbox)
              .select(
                database
                  .select({
                    createdAt: sql`${timestamp}`.as("created_at"),
                    createdByUserId: sql`${validated.actor.userId}`.as(
                      "created_by_user_id"
                    ),
                    displayName: sql`${displayName}`.as("display_name"),
                    id: sql`${mailboxId}`.as("id"),
                    organizationId: sql`${LEGACY_DEFAULT_ORGANIZATION_ID}`.as(
                      "organization_id"
                    ),
                    updatedAt: sql`${timestamp}`.as("updated_at"),
                  })
                  .from(appAuthorizationGuard)
                  .where(
                    and(
                      eq(appAuthorizationGuard.nonce, nonce),
                      mailboxAvailable
                    )
                  )
              )
              .returning({ id: appMailbox.id }),
            primaryMailboxAddressInsertStatement(database, {
              address: input.initialAddress,
              authorizationGuardNonce: nonce,
              createdAt: timestamp,
              mailboxId,
              mailboxCreated,
              normalizedAddress: normalizeEmailAddressDomain(
                input.initialAddress
              ),
            }),
            database
              .insert(appMailboxMember)
              .select(
                database
                  .select({
                    createdAt: sql`${timestamp}`.as("created_at"),
                    mailboxId: sql`${mailboxId}`.as("mailbox_id"),
                    updatedAt: sql`${timestamp}`.as("updated_at"),
                    userId: sql`${validated.actor.userId}`.as("user_id"),
                  })
                  .from(appAuthorizationGuard)
                  .innerJoin(appMailbox, createdMailbox)
                  .where(eq(appAuthorizationGuard.nonce, nonce))
              )
              .onConflictDoNothing(),
            database
              .insert(authRoleGrant)
              .select(
                database
                  .select({
                    expiresAt: sql<null>`null`.as("expires_at"),
                    metadata: sql<null>`null`.as("metadata"),
                    revokedAt: sql<null>`null`.as("revoked_at"),
                    roleId: sql`${LegacyMailboxRole.owner}`.as("role_id"),
                    scopeId: sql`${mailboxId}`.as("scope_id"),
                    scopeIdPresent: sql<number>`1`.as("scope_id_present"),
                    scopeType: sql`${"mailbox"}`.as("scope_type"),
                    subjectId: sql`${validated.actor.userId}`.as("subject_id"),
                    subjectType: sql`${"user"}`.as("subject_type"),
                  })
                  .from(appAuthorizationGuard)
                  .innerJoin(appMailbox, createdMailbox)
                  .where(eq(appAuthorizationGuard.nonce, nonce))
              )
              .onConflictDoNothing(),
            database.insert(appMailboxBootstrapSecurityIntent).select(
              sql`select ${input.operationId}, ${validated.actor.userId},
                         ${acknowledgedRotationOperationId}, 1
                    where ${authorized}`
            ),
            database
              .insert(appMailboxAdministrationReceipt)
              .select(
                database
                  .select({
                    actorUserId: sql`${validated.actor.userId}`.as(
                      "actor_user_id"
                    ),
                    committedAt: appMailbox.updatedAt,
                    displayName: sql`${displayName}`.as("display_name"),
                    expectedVersion: sql<null>`null`.as("expected_version"),
                    mailboxId: sql`${mailboxId}`.as("mailbox_id"),
                    operationId: sql`${input.operationId}`.as("operation_id"),
                    operationKind:
                      sql<"bootstrap-owner">`${"bootstrap-owner"}`.as(
                        "operation_kind"
                      ),
                    resultCreatedAt: appMailbox.createdAt,
                    resultCreatedByUserId: appMailbox.createdByUserId,
                    resultDisplayName: appMailbox.displayName,
                    resultMailboxId: appMailbox.id,
                    resultStatus: appMailbox.status,
                    resultUpdatedAt: appMailbox.updatedAt,
                    resultVersion: appMailbox.version,
                    schemaVersion: sql<1>`1`.as("schema_version"),
                  })
                  .from(appMailbox)
                  .where(and(createdMailbox, authorized))
              )
              .returning(receiptReturning),
            database
              .insert(appMailboxBootstrapReceiptV2)
              .select(
                database
                  .select({
                    initialAddress: sql`${input.initialAddress}`.as(
                      "initial_address"
                    ),
                    operationId: sql`${input.operationId}`.as("operation_id"),
                    schemaVersion: sql<2>`2`.as("schema_version"),
                  })
                  .from(appMailboxAdministrationReceipt)
                  .where(
                    and(
                      eq(
                        appMailboxAdministrationReceipt.operationId,
                        input.operationId
                      ),
                      authorized
                    )
                  )
              )
              .returning({
                initial_address: appMailboxBootstrapReceiptV2.initialAddress,
                operation_id: appMailboxBootstrapReceiptV2.operationId,
                schema_version: appMailboxBootstrapReceiptV2.schemaVersion,
              }),
            database.insert(appMailboxBootstrapDomainIntent).select(
              database
                .select({
                  canonicalDomain: sql`${input.initialDomain}`.as(
                    "canonical_domain"
                  ),
                  canonicalizationProfileId:
                    sql`${MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID}`.as(
                      "canonicalization_profile_id"
                    ),
                  canonicalizationVersion:
                    sql<1>`${MAIL_DOMAIN_CANONICALIZATION_VERSION}`.as(
                      "canonicalization_version"
                    ),
                  operationId: appMailboxAdministrationReceipt.operationId,
                  schemaVersion: sql<1>`1`.as("schema_version"),
                })
                .from(appMailboxAdministrationReceipt)
                .innerJoin(
                  appAuthorizationGuard,
                  eq(appAuthorizationGuard.nonce, nonce)
                )
                .where(
                  eq(
                    appMailboxAdministrationReceipt.operationId,
                    input.operationId
                  )
                )
            ),
            administrativeAuditInsertStatement(database, auditEvent, nonce),
            database.delete(appMailboxBootstrapSecurityIntent).where(
              and(
                eq(
                  appMailboxBootstrapSecurityIntent.operationId,
                  input.operationId
                ),
                notExists(
                  database
                    .select({ value: sql`1` })
                    .from(appMailboxAdministrationReceipt)
                    .where(
                      eq(
                        appMailboxAdministrationReceipt.operationId,
                        input.operationId
                      )
                    )
                )
              )
            ),
            database
              .delete(appAuthorizationGuard)
              .where(eq(appAuthorizationGuard.nonce, nonce)),
          ];
          const results = yield* batch.execute(statements).pipe(
            Effect.catchTag("ControlPlaneBatchError", (error) =>
              error.commitState === "unknown"
                ? readReceipt(
                    input.operationId,
                    validated.actor.userId,
                    "bootstrap-owner"
                  ).pipe(
                    Effect.flatMap((receipt) =>
                      receipt === null
                        ? Effect.fail(storageError("bootstrap-owner", error))
                        : receiptMatchesIntent(
                            receipt,
                            {
                              displayName,
                              acknowledgedRecoveryCodeRotationOperationId:
                                input.acknowledgedRecoveryCodeRotationOperationId,
                              initialAddress: input.initialAddress,
                              mailboxId,
                              operationKind: "bootstrap-owner",
                            },
                            "bootstrap-owner"
                          ).pipe(
                            Effect.flatMap((matches) =>
                              matches
                                ? Effect.succeed(receipt)
                                : Effect.fail(
                                    new MailboxAdministrationError({
                                      message:
                                        "Operation ID was used for a different intent",
                                      operation: "bootstrap-owner",
                                      reason: "operation-conflict",
                                    })
                                  )
                            )
                          )
                    )
                  )
                : Effect.fail(storageError("bootstrap-owner", error))
            )
          );
          if (results instanceof MailboxAdministrationReceipt) {
            return results.result;
          }
          const [status] = yield* decodeResultRows(
            BootstrapStatusRow,
            results,
            1,
            "bootstrap-owner"
          );
          const created = yield* decodeResultRows(
            CreatedMailboxRow,
            results,
            3,
            "bootstrap-owner"
          );

          if (status?.authorized !== 1) {
            if (status?.base_session_valid !== 1) {
              return yield* new MailboxAdministrationError({
                message: "Session changed before mailbox creation",
                operation: "bootstrap-owner",
                reason: "session-recheck",
              });
            }
            if (status.step_up_valid !== 1) {
              return yield* new MailboxAdministrationError({
                message: "Recent authentication is required",
                operation: "bootstrap-owner",
                reason: "step-up-required",
              });
            }
            if (status.catalog_valid !== 1) {
              return yield* Effect.die(
                new Error("Owner role catalog is not active")
              );
            }
            if (status.owner_eligible !== 1) {
              return yield* new MailboxAdministrationError({
                message: "Current user is not eligible to own the mailbox",
                operation: "bootstrap-owner",
                reason: "owner-not-eligible",
              });
            }
            if (status.operation_available !== 1) {
              const concurrentReplay = yield* readReceipt(
                input.operationId,
                validated.actor.userId,
                "bootstrap-owner"
              );
              if (
                concurrentReplay !== null &&
                (yield* receiptMatchesIntent(
                  concurrentReplay,
                  {
                    displayName,
                    acknowledgedRecoveryCodeRotationOperationId:
                      input.acknowledgedRecoveryCodeRotationOperationId,
                    initialAddress: input.initialAddress,
                    mailboxId,
                    operationKind: "bootstrap-owner",
                  },
                  "bootstrap-owner"
                ))
              ) {
                return concurrentReplay.result;
              }
              return yield* new MailboxAdministrationError({
                message: "Operation ID was used for a different intent",
                operation: "bootstrap-owner",
                reason: "operation-conflict",
              });
            }
            if (
              status.seal_actor_valid !== 1 ||
              status.recovery_ready !== 1 ||
              status.passkeys_ready !== 1 ||
              status.recovery_codes_ready !== 1
            ) {
              return yield* new MailboxAdministrationError({
                message:
                  "Complete account security setup before creating the mailbox",
                operation: "bootstrap-owner",
                reason: "security-setup-required",
              });
            }
            if (status.mailbox_available !== 1) {
              return yield* new MailboxAdministrationError({
                message: "Primary mailbox already exists",
                operation: "bootstrap-owner",
                reason: "conflict",
              });
            }
            return yield* Effect.die(
              new Error("Owner bootstrap authorization guard is inconsistent")
            );
          }
          if (created.length !== 1) {
            return yield* new MailboxAdministrationError({
              message: "Primary mailbox already exists",
              operation: "bootstrap-owner",
              reason: "conflict",
            });
          }

          const [receiptV2Row] = yield* decodeResultRows(
            BootstrapReceiptV2Row,
            results,
            9,
            "bootstrap-owner"
          );
          if (
            receiptV2Row === undefined ||
            receiptV2Row.operation_id !== input.operationId ||
            receiptV2Row.initial_address !== input.initialAddress
          ) {
            return yield* new MailboxAdministrationError({
              commitState: "committed",
              message: "Created mailbox bootstrap receipt was missing",
              operation: "bootstrap-owner",
              reason: "storage",
            });
          }
          const receipt = yield* readReceipt(
            input.operationId,
            validated.actor.userId,
            "bootstrap-owner"
          );
          if (receipt === null) {
            return yield* new MailboxAdministrationError({
              commitState: "committed",
              message: "Created mailbox receipt readback was missing",
              operation: "bootstrap-owner",
              reason: "storage",
            });
          }
          return receipt.result;
        }),
      readOperation: (untrusted: unknown) =>
        Effect.gen(function* () {
          const input = yield* Schema.decodeUnknownEffect(
            ReadMailboxAdministrationOperationQuery
          )(untrusted).pipe(
            Effect.mapError(
              (cause) =>
                new MailboxAdministrationError({
                  cause,
                  message: "Invalid mailbox operation query",
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
            return yield* new MailboxAdministrationError({
              message: "Mailbox operation receipt not found",
              operation: "read-operation",
              reason: "not-found",
            });
          }
          return receipt;
        }),
      rename: (untrusted: unknown) =>
        Effect.gen(function* () {
          const input = yield* Schema.decodeUnknownEffect(RenameMailboxCommand)(
            untrusted
          ).pipe(
            Effect.mapError(
              (cause) =>
                new MailboxAdministrationError({
                  cause,
                  message: "Invalid mailbox rename command",
                  operation: "rename",
                  reason: "invalid-input",
                })
            )
          );
          const requestAuth = yield* CurrentRequestAuth;
          const principal = yield* AuthPermission.CurrentPrincipal;
          yield* ensureTrustedAuthInvariant(requestAuth, principal);
          yield* requireUnrestrictedSession(requestAuth, "rename");
          const replay = yield* readReceipt(
            input.operationId,
            requestAuth.validated.actor.userId,
            "rename"
          );
          if (replay !== null) {
            if (
              !receiptMatches(replay, {
                displayName: input.displayName,
                expectedVersion: input.expectedVersion,
                mailboxId: input.mailboxId,
                operationKind: "rename",
              })
            ) {
              return yield* new MailboxAdministrationError({
                message: "Operation ID was used for a different intent",
                operation: "rename",
                reason: "operation-conflict",
              });
            }
            return replay.result;
          }
          const displayName = yield* validateDisplayName(
            input.displayName,
            "rename"
          );
          const location = yield* authorization.requireMailbox({
            action: "manage-settings",
            resource: { _tag: "Mailbox", mailboxId: input.mailboxId },
          });
          const timestamp = Schema.decodeUnknownSync(UnixMillis)(now());
          const nonce = randomId();
          const scope = mailboxScope(makeMailboxScopeId(location.mailboxId));
          const trustedSession = transactionalSessionPredicate(
            database,
            requestAuth,
            timestamp
          );
          const trustedPermission = permissionPredicate(
            database,
            principal,
            AuthorizationPermission.mailboxManageSettings,
            scope
          );
          const auditEvent = yield* audit
            .prepare({
              _tag: "MailboxRenamed",
              beforeVersion: input.expectedVersion,
              mailboxId: location.mailboxId,
              occurredAt: timestamp,
              operationId: input.operationId,
            })
            .pipe(Effect.mapError((error) => auditError("rename", error)));
          const mailboxExists = exists(
            database
              .select({ value: sql`1` })
              .from(appMailbox)
              .where(
                and(
                  eq(appMailbox.id, location.mailboxId),
                  eq(appMailbox.status, "active"),
                  canonicalMailboxAncestryPredicate(
                    database,
                    location.mailboxId
                  )
                )
              )
          );
          const mailboxAtVersion = exists(
            database
              .select({ value: sql`1` })
              .from(appMailbox)
              .where(
                and(
                  eq(appMailbox.id, location.mailboxId),
                  eq(appMailbox.status, "active"),
                  eq(appMailbox.version, input.expectedVersion),
                  canonicalMailboxAncestryPredicate(
                    database,
                    location.mailboxId
                  )
                )
              )
          );
          const operationAvailable = notExists(
            database
              .select({ value: sql`1` })
              .from(appMailboxAdministrationReceipt)
              .where(
                eq(
                  appMailboxAdministrationReceipt.operationId,
                  input.operationId
                )
              )
          );
          const authorized = exists(
            database
              .select({ value: sql`1` })
              .from(appAuthorizationGuard)
              .where(eq(appAuthorizationGuard.nonce, nonce))
          );
          const statements: ControlPlane.ControlPlaneStatements = [
            database.insert(appAuthorizationGuard).select(
              sql`select ${nonce}
                      where ${trustedSession}
                        and ${trustedPermission}
                        and ${mailboxAtVersion}
                        and ${operationAvailable}`
            ),
            database
              .update(appMailbox)
              .set({
                displayName,
                updatedAt: timestamp,
                version: sql`${appMailbox.version} + 1`,
              })
              .where(
                and(
                  eq(appMailbox.id, location.mailboxId),
                  eq(appMailbox.status, "active"),
                  eq(appMailbox.version, input.expectedVersion),
                  canonicalMailboxAncestryPredicate(
                    database,
                    location.mailboxId
                  ),
                  authorized
                )
              )
              .returning({
                created_at: appMailbox.createdAt,
                created_by_user_id: appMailbox.createdByUserId,
                display_name: appMailbox.displayName,
                id: appMailbox.id,
                updated_at: appMailbox.updatedAt,
                version: appMailbox.version,
              }),
            database
              .insert(appMailboxAdministrationReceipt)
              .select(
                database
                  .select({
                    actorUserId: sql`${requestAuth.validated.actor.userId}`.as(
                      "actor_user_id"
                    ),
                    committedAt: appMailbox.updatedAt,
                    displayName: sql`${displayName}`.as("display_name"),
                    expectedVersion: sql`${input.expectedVersion}`.as(
                      "expected_version"
                    ),
                    mailboxId: sql`${location.mailboxId}`.as("mailbox_id"),
                    operationId: sql`${input.operationId}`.as("operation_id"),
                    operationKind: sql<"rename">`${"rename"}`.as(
                      "operation_kind"
                    ),
                    resultCreatedAt: appMailbox.createdAt,
                    resultCreatedByUserId: appMailbox.createdByUserId,
                    resultDisplayName: appMailbox.displayName,
                    resultMailboxId: appMailbox.id,
                    resultStatus: appMailbox.status,
                    resultUpdatedAt: appMailbox.updatedAt,
                    resultVersion: appMailbox.version,
                    schemaVersion: sql<1>`1`.as("schema_version"),
                  })
                  .from(appMailbox)
                  .where(
                    and(
                      eq(appMailbox.id, location.mailboxId),
                      eq(appMailbox.status, "active"),
                      eq(appMailbox.version, input.expectedVersion + 1),
                      canonicalMailboxAncestryPredicate(
                        database,
                        location.mailboxId
                      ),
                      authorized
                    )
                  )
              )
              .returning(receiptReturning),
            administrativeAuditInsertStatement(database, auditEvent, nonce),
            database.all(sql`select cast(${trustedSession} as integer)
                                      as session_valid,
                                   cast(${trustedPermission} as integer)
                                      as permission_valid,
                                   cast(${mailboxExists} as integer)
                                      as mailbox_exists,
                                   cast(${mailboxAtVersion} as integer)
                                      as version_valid,
                                   cast(${operationAvailable} as integer)
                                      as operation_available,
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
                    "rename"
                  ).pipe(
                    Effect.flatMap((receipt) =>
                      receipt === null
                        ? Effect.fail(storageError("rename", error))
                        : receiptMatches(receipt, {
                              displayName,
                              expectedVersion: input.expectedVersion,
                              mailboxId: location.mailboxId,
                              operationKind: "rename",
                            })
                          ? Effect.succeed(receipt)
                          : Effect.fail(
                              new MailboxAdministrationError({
                                message:
                                  "Operation ID was used for a different intent",
                                operation: "rename",
                                reason: "operation-conflict",
                              })
                            )
                    )
                  )
                : Effect.fail(storageError("rename", error))
            )
          );
          if (results instanceof MailboxAdministrationReceipt) {
            return results.result;
          }
          const [status] = yield* decodeResultRows(
            RenameStatusRow,
            results,
            4,
            "rename"
          );

          if (status?.authorized !== 1) {
            if (status?.session_valid !== 1) {
              return yield* new MailboxAdministrationError({
                message: "Session changed before mailbox mutation",
                operation: "rename",
                reason: "session-recheck",
              });
            }
            if (status.operation_available !== 1) {
              const concurrentReplay = yield* readReceipt(
                input.operationId,
                requestAuth.validated.actor.userId,
                "rename"
              );
              if (
                concurrentReplay !== null &&
                receiptMatches(concurrentReplay, {
                  displayName,
                  expectedVersion: input.expectedVersion,
                  mailboxId: location.mailboxId,
                  operationKind: "rename",
                })
              ) {
                return concurrentReplay.result;
              }
              return yield* new MailboxAdministrationError({
                message: "Operation ID was used for a different intent",
                operation: "rename",
                reason: "operation-conflict",
              });
            }
            if (status.mailbox_exists !== 1) {
              return yield* new MailboxAdministrationError({
                message: "Mailbox not found",
                operation: "rename",
                reason: "not-found",
              });
            }
            if (status.version_valid !== 1) {
              return yield* new MailboxAdministrationError({
                message: "Mailbox changed before mutation",
                operation: "rename",
                reason: "conflict",
              });
            }
            return yield* new MailboxAdministrationError({
              message: "Permission changed before mailbox mutation",
              operation: "rename",
              permission: AuthorizationPermission.mailboxManageSettings,
              reason: "authorization-recheck",
              scope,
            });
          }

          const [row] = yield* decodeResultRows(
            RenamedMailboxRow,
            results,
            1,
            "rename"
          );
          if (row === undefined) {
            return yield* new MailboxAdministrationError({
              message: "Mailbox not found",
              operation: "rename",
              reason: "not-found",
            });
          }

          const [receiptRow] = yield* decodeResultRows(
            ReceiptRow,
            results,
            2,
            "rename"
          );
          if (receiptRow === undefined) {
            return yield* new MailboxAdministrationError({
              commitState: "committed",
              message: "Renamed mailbox receipt was missing",
              operation: "rename",
              reason: "storage",
            });
          }
          const receipt = yield* decodeReceipt(receiptRow, "rename");
          return receipt.result;
        }),
    };

    return Context.make(
      OrganizationBootstrapTransaction,
      OrganizationBootstrapTransaction.of({ bootstrap: services.bootstrap })
    ).pipe(
      Context.add(
        MailboxAdministrationTransaction,
        MailboxAdministrationTransaction.of({
          readOperation: services.readOperation,
          rename: services.rename,
        })
      )
    );
  })
);

export const OrganizationBootstrapD1Layer =
  OrganizationBootstrap.layerNoDeps.pipe(
    Layer.provide(OrganizationTransactionsD1Layer)
  );

export const OrganizationBootstrapTransactionD1Layer = Layer.effect(
  OrganizationBootstrapTransaction,
  OrganizationBootstrapTransaction
).pipe(Layer.provide(OrganizationTransactionsD1Layer));

export const MailboxAdministrationD1Layer =
  MailboxAdministration.layerNoDeps.pipe(
    Layer.provide(OrganizationTransactionsD1Layer)
  );
