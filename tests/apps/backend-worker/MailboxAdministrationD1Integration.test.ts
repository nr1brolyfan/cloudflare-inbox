/* oxlint-disable vitest/max-expects -- Integration cases verify atomic cross-table states. */
import { DatabaseSync } from "node:sqlite";

import type { D1EffectQbDatabaseLike } from "@effect-auth/core/EffectQbSqliteStorage";
import { D1EffectQbSqliteAuthStorageLive } from "@effect-auth/core/EffectQbSqliteStorage";
import {
  CredentialId,
  SessionId,
  SessionToken,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import * as AuthPermission from "@effect-auth/core/Permission";
import type { ValidatedSession } from "@effect-auth/core/Sessions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  MailboxAdministrationD1Layer,
  MailboxAdministrationRuntime,
} from "#/apps/backend-worker/MailboxAdministrationD1Integration";
import { CONTROL_PLANE_STEP_UP_POLICY } from "#/modules/account-security/domain/StepUpPolicy";
import { SensitiveOperationStepUpClock } from "#/modules/account-security/ports/SensitiveOperationStepUpClock";
import { AdministrativeAudit } from "#/modules/administrative-audit/contracts/AdministrativeAudit";
import { AdministrativeAuditRuntimeLayer } from "#/modules/administrative-audit/layers/AdministrativeAuditLayer";
import { MailPermissionsEffectAuthLayer } from "#/modules/authorization/adapters/effect-auth/MailPermissionsEffectAuth";
import { MailboxAuthorizationApplicationLayer } from "#/modules/authorization/application/MailboxAuthorization";
import {
  AuthorizationPermission as MailPermission,
  LegacyMailboxRole,
  makeMailboxScopeId,
  mailboxScope,
} from "#/modules/authorization/contracts/AuthorizationCatalog";
import { TrustedMailResourceResolver } from "#/modules/authorization/ports/TrustedMailResourceResolver";
import { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import {
  AttachmentLocation,
  DraftLocation,
  FolderLocation,
  MessageLocation,
  RuleLocation,
} from "#/modules/mailbox/domain/MailboxResource";
import { MailboxAuthorization } from "#/modules/mailbox/ports/MailboxAuthorization";
import type { MailboxAuthorizationService } from "#/modules/mailbox/ports/MailboxAuthorization";
import {
  MailboxAdministration,
  MailboxAdministrationError,
} from "#/modules/organization/application/MailboxAdministration";
import {
  MailboxBootstrapConfig,
  MailboxBootstrapConfigValue,
} from "#/modules/organization/contracts/MailboxBootstrapConfig";
import { MailboxDisplayName } from "#/modules/organization/domain/Mailbox";
import { ControlPlaneD1Layer } from "#/platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneD1Binding } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import { NormalizedEmailAddress } from "#/shared/EmailAddress";
import { AdministrativeOperationId } from "#/shared/Operation";
import { CurrentRequestAuth } from "#/shared/RequestAuth";
import {
  CurrentRequestCorrelation,
  RequestCorrelation,
} from "#/shared/RequestCorrelation";
import { Version } from "#/shared/Temporal";

import {
  applyControlPlaneMigration,
  applyControlPlaneMigrations,
  applyControlPlaneMigrationsThrough,
  insertFreshCutoverOrganization,
  makeTestD1Database,
} from "../../support/d1";

const now = 2000;
const stepUpNow = Date.now();
const recentPasswordEvent = {
  credentialId: CredentialId("credential-a"),
  type: "password" as const,
  verifiedAt: UnixMillis(stepUpNow - 100),
  version: 1 as const,
};
const requestContext = Schema.decodeUnknownSync(RequestCorrelation)({
  correlationId: "00000000-0000-4000-8000-000000000002",
  requestId: "00000000-0000-4000-8000-000000000001",
});
const administrativeAuditLayer = AdministrativeAudit.layerNoDeps.pipe(
  Layer.provide(AdministrativeAuditRuntimeLayer)
);

const makeValidatedSession = (
  user: string,
  session: string,
  rotatedAt?: number,
  authenticationEvents: ValidatedSession["currentSession"]["authenticationEvents"] = [
    recentPasswordEvent,
  ]
): ValidatedSession => {
  const userId = UserId(user);
  const sessionId = SessionId(session);
  let authTime = 1000;
  for (const event of authenticationEvents) {
    authTime = Math.max(authTime, event.verifiedAt);
  }
  const currentSession = {
    aal: "aal1" as const,
    amr:
      authenticationEvents.length === 0
        ? []
        : authenticationEvents.map((event) =>
            event.type === "password" ? "pwd" : event.type
          ),
    authenticationEvents,
    authTime: UnixMillis(authTime),
    expiresAt: UnixMillis(stepUpNow + 60 * 60 * 1000),
    sessionId,
    userId,
  };

  return {
    actor: { sessionId, userId },
    currentSession,
    issued: {
      ...currentSession,
      ...(rotatedAt === undefined ? {} : { rotatedAt: UnixMillis(rotatedAt) }),
      token: SessionToken(`${sessionId}.secret`),
    },
  };
};

const insertCurrentSession = (
  database: DatabaseSync,
  validated: ValidatedSession
) => {
  database
    .prepare(
      `insert or ignore into auth_user
        (id, created_at, updated_at)
       values (?, ?, ?)`
    )
    .run(validated.actor.userId, 1000, 1000);
  const email = `${validated.actor.userId}@example.test`;
  database
    .prepare(
      `insert into auth_user_identity
        (id, user_id, scope_type, scope_id, kind, value, normalized_value,
         verified_at, is_primary_login, created_at, updated_at)
       values (?, ?, 'global', 'global', 'email', ?, ?, ?, 1, ?, ?)`
    )
    .run(
      `identity-${validated.actor.userId}`,
      validated.actor.userId,
      email,
      email,
      1000,
      1000,
      1000
    );
  database
    .prepare(
      `insert into auth_session
        (id, user_id, secret_hash, created_at, expires_at, auth_time,
          authentication_events, aal, amr, rotated_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      validated.actor.sessionId,
      validated.actor.userId,
      "hash",
      1000,
      validated.issued.expiresAt,
      validated.issued.authTime,
      JSON.stringify(validated.issued.authenticationEvents),
      validated.issued.aal,
      JSON.stringify(validated.issued.amr),
      validated.issued.rotatedAt ?? null
    );
};

const makeResolverLive = () =>
  Layer.succeed(
    TrustedMailResourceResolver,
    TrustedMailResourceResolver.of({
      resolveAttachment: (resource) =>
        Effect.succeed(
          Schema.decodeUnknownSync(AttachmentLocation)({
            _tag: "Attachment",
            attachmentId: resource.attachmentId,
            folderId: "folder-a",
            mailboxId: resource.mailboxId,
            messageId: "message-a",
          })
        ),
      resolveDraft: (resource) =>
        Effect.succeed(
          Schema.decodeUnknownSync(DraftLocation)({
            _tag: "Draft",
            draftId: resource.draftId,
            mailboxId: resource.mailboxId,
          })
        ),
      resolveFolder: (resource) =>
        Effect.succeed(
          Schema.decodeUnknownSync(FolderLocation)({
            _tag: "Folder",
            folderId: resource.folderId,
            mailboxId: resource.mailboxId,
          })
        ),
      resolveMessage: (resource) =>
        Effect.succeed(
          Schema.decodeUnknownSync(MessageLocation)({
            _tag: "Message",
            folderId: "folder-a",
            mailboxId: resource.mailboxId,
            messageId: resource.messageId,
          })
        ),
      resolveRule: (resource) =>
        Effect.succeed(
          Schema.decodeUnknownSync(RuleLocation)({
            _tag: "Rule",
            mailboxId: resource.mailboxId,
            ruleId: resource.ruleId,
          })
        ),
    })
  );

const makePermissionRaceLive = (mutation: () => void) =>
  MailboxAuthorizationApplicationLayer.pipe(
    Layer.provide(
      Layer.merge(
        Layer.succeed(
          AuthPermission.Permissions,
          AuthPermission.Permissions.of({
            hasPermission: () =>
              Effect.sync(() => {
                mutation();
                return true;
              }),
            hasRole: () => Effect.succeed(false),
          })
        ),
        makeResolverLive()
      )
    )
  );

const unavailableMailAuthorizationLive = Layer.succeed(
  MailboxAuthorization,
  MailboxAuthorization.of({} as MailboxAuthorizationService)
);

const controlPlaneBatchLive = (database: D1EffectQbDatabaseLike) =>
  ControlPlaneD1Layer.pipe(
    Layer.provide(
      Layer.succeed(
        ControlPlaneD1Binding,
        ControlPlaneD1Binding.of({
          database: database as unknown as D1Database,
        })
      )
    )
  );

const withDatabaseTimes = (
  database: D1EffectQbDatabaseLike,
  databaseTimes: readonly number[]
): D1EffectQbDatabaseLike => {
  let timeStatement = 0;
  return {
    ...database,
    prepare: (statement) => {
      if (!statement.includes("unixepoch('subsec')")) {
        return database.prepare(statement);
      }
      const databaseNow = databaseTimes[timeStatement] ?? databaseTimes.at(-1);
      timeStatement += 1;
      return database.prepare(
        databaseNow === undefined
          ? statement
          : statement.replaceAll(
              "unixepoch('subsec')",
              String(databaseNow / 1000)
            )
      );
    },
  };
};

const provideRequestAuth = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    | AuthPermission.CurrentPrincipal
    | RequestCorrelation
    | CurrentRequestAuth
    | R
  >,
  validated: ValidatedSession
) =>
  effect.pipe(
    Effect.provideService(
      CurrentRequestAuth,
      CurrentRequestAuth.of({ sessionSecretHash: "hash", validated })
    ),
    Effect.provideService(
      AuthPermission.CurrentPrincipal,
      AuthPermission.CurrentPrincipal.of(
        AuthPermission.PermissionSubject.user(validated.actor.userId)
      )
    ),
    Effect.provideService(CurrentRequestCorrelation, requestContext)
  );

const canonicalTestAddress = (address: string) => {
  const separator = address.lastIndexOf("@");
  return `${address.slice(0, separator)}@${address.slice(separator + 1).toLowerCase()}`;
};

const bootstrap = (
  database: D1EffectQbDatabaseLike,
  validated: ValidatedSession,
  nonce: string,
  ownerEmail = "user-a@example.test",
  operationId = "00000000-0000-4000-8000-000000000010",
  displayName = "Inbox",
  configuredInitialAddress = ownerEmail,
  configuredOwnerAllowlist = [canonicalTestAddress(ownerEmail)],
  commandInitialAddress = configuredInitialAddress
) =>
  provideRequestAuth(
    Effect.gen(function* () {
      const administration = yield* MailboxAdministration;
      return yield* administration.bootstrapOwner({
        displayName: Schema.decodeUnknownSync(MailboxDisplayName)(displayName),
        initialAddress: Schema.decodeUnknownSync(NormalizedEmailAddress)(
          canonicalTestAddress(commandInitialAddress)
        ),
        operationId: Schema.decodeUnknownSync(AdministrativeOperationId)(
          operationId
        ),
      });
    }).pipe(
      Effect.provide(
        MailboxAdministrationD1Layer.pipe(
          Layer.provide(unavailableMailAuthorizationLive),
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                MailboxBootstrapConfig,
                MailboxBootstrapConfig.of(
                  Schema.decodeUnknownSync(MailboxBootstrapConfigValue)({
                    initialAddress: canonicalTestAddress(
                      configuredInitialAddress
                    ),
                    initialDomain: canonicalTestAddress(
                      configuredInitialAddress
                    ).slice(configuredInitialAddress.lastIndexOf("@") + 1),
                    ownerEmailAllowlist: configuredOwnerAllowlist,
                  })
                )
              ),
              administrativeAuditLayer,
              Layer.succeed(
                MailboxAdministrationRuntime,
                MailboxAdministrationRuntime.of({
                  now: () => now,
                  randomId: () => nonce,
                })
              ),
              Layer.succeed(
                SensitiveOperationStepUpClock,
                SensitiveOperationStepUpClock.of({ now: () => stepUpNow })
              )
            )
          ),
          Layer.provide(controlPlaneBatchLive(database))
        )
      )
    ),
    validated
  );

const rename = (
  database: D1EffectQbDatabaseLike,
  validated: ValidatedSession,
  mailAuthorizationLive: Layer.Layer<MailboxAuthorization>,
  mailboxId: string,
  displayName: string,
  expectedVersion = 1,
  operationId = "00000000-0000-4000-8000-000000000011"
) =>
  provideRequestAuth(
    Effect.gen(function* () {
      const administration = yield* MailboxAdministration;
      return yield* administration.rename({
        displayName: Schema.decodeUnknownSync(MailboxDisplayName)(displayName),
        expectedVersion: Schema.decodeUnknownSync(Version)(expectedVersion),
        mailboxId: Schema.decodeUnknownSync(MailboxId)(mailboxId),
        operationId: Schema.decodeUnknownSync(AdministrativeOperationId)(
          operationId
        ),
      });
    }).pipe(
      Effect.provide(
        MailboxAdministrationD1Layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                MailboxBootstrapConfig,
                MailboxBootstrapConfig.of(
                  Schema.decodeUnknownSync(MailboxBootstrapConfigValue)({
                    initialAddress: "inbox@example.test",
                    initialDomain: "example.test",
                    ownerEmailAllowlist: ["user-a@example.test"],
                  })
                )
              ),
              administrativeAuditLayer,
              Layer.succeed(
                MailboxAdministrationRuntime,
                MailboxAdministrationRuntime.of({
                  now: () => now + 1000,
                  randomId: () => "rename-guard",
                })
              ),
              Layer.succeed(
                SensitiveOperationStepUpClock,
                SensitiveOperationStepUpClock.of({ now: () => stepUpNow })
              )
            )
          ),
          Layer.provide(controlPlaneBatchLive(database))
        )
      ),
      Effect.provide(mailAuthorizationLive)
    ),
    validated
  );

const readOperation = (
  database: D1EffectQbDatabaseLike,
  validated: ValidatedSession,
  operationId = "00000000-0000-4000-8000-000000000010"
) =>
  provideRequestAuth(
    Effect.gen(function* () {
      const administration = yield* MailboxAdministration;
      return yield* administration.readOperation({
        operationId: Schema.decodeUnknownSync(AdministrativeOperationId)(
          operationId
        ),
      });
    }).pipe(
      Effect.provide(
        MailboxAdministrationD1Layer.pipe(
          Layer.provide(unavailableMailAuthorizationLive),
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                MailboxBootstrapConfig,
                MailboxBootstrapConfig.of(
                  Schema.decodeUnknownSync(MailboxBootstrapConfigValue)({
                    initialAddress: "inbox@example.test",
                    initialDomain: "example.test",
                    ownerEmailAllowlist: ["user-a@example.test"],
                  })
                )
              ),
              administrativeAuditLayer,
              Layer.succeed(
                MailboxAdministrationRuntime,
                MailboxAdministrationRuntime.of({
                  now: () => now,
                  randomId: () => "read-guard",
                })
              ),
              Layer.succeed(
                SensitiveOperationStepUpClock,
                SensitiveOperationStepUpClock.of({ now: () => stepUpNow })
              )
            )
          ),
          Layer.provide(controlPlaneBatchLive(database))
        )
      )
    ),
    validated
  );

const countRows = (database: DatabaseSync, table: string) =>
  (
    database.prepare(`select count(*) as count from ${table}`).get() as {
      count: number;
    }
  ).count;

const seedHistoricalBootstrapReceipt = (
  database: DatabaseSync,
  address = "inbox@example.test",
  normalizedAddress = "inbox@example.test"
) => {
  insertFreshCutoverOrganization(database, now);
  database.exec(`
    insert into app_mailbox
      (id, display_name, status, created_by_user_id, created_at, updated_at,
       version)
    values ('primary', 'Inbox', 'active', 'user-a', ${now}, ${now}, 1);
    insert into app_mailbox_address
      (mailbox_id, id, address, normalized_address, is_primary, enabled,
       created_at, updated_at)
    values ('primary', 'primary', '${address}', '${normalizedAddress}', 1, 1,
            ${now}, ${now});
    insert into app_mailbox_administration_receipt
      (operation_id, operation_kind, actor_user_id, mailbox_id, display_name,
       expected_version, result_mailbox_id, result_display_name, result_status,
       result_created_by_user_id, result_created_at, result_updated_at,
       result_version, committed_at, schema_version)
    values ('00000000-0000-4000-8000-000000000010', 'bootstrap-owner',
            'user-a', 'primary', 'Inbox', null, 'primary', 'Inbox', 'active',
            'user-a', ${now}, ${now}, 1, ${now}, 1);
  `);
};

describe("mailbox administration", () => {
  it("atomically creates the mailbox, discovery member, and owner grant", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);

      const mailbox = await Effect.runPromise(
        bootstrap(d1, validated, "bootstrap-guard")
      );
      const canManage = await Effect.runPromise(
        Effect.gen(function* () {
          const permissions = yield* AuthPermission.Permissions;
          return yield* permissions.hasPermission({
            permission: MailPermission.mailboxManageSettings,
            scope: mailboxScope(makeMailboxScopeId(mailbox.id)),
            subject: AuthPermission.PermissionSubject.user(
              validated.actor.userId
            ),
          });
        }).pipe(
          Effect.provide(
            MailPermissionsEffectAuthLayer.pipe(
              Layer.provide(D1EffectQbSqliteAuthStorageLive(d1))
            )
          )
        )
      );
      await expect(
        applyControlPlaneMigration(
          database,
          "1023_app_organization_legacy_cutover.sql"
        )
      ).rejects.toThrow(/constraint/iu);
      expect(mailbox).toMatchObject({
        createdByUserId: "user-a",
        displayName: "Inbox",
        id: "primary",
        status: "active",
        version: 1,
      });
      expect({
        addresses: countRows(database, "app_mailbox_address"),
        auditEvents: countRows(database, "app_administrative_audit_event"),
        canManage,
        guards: countRows(database, "app_authorization_guard"),
        mailboxes: countRows(database, "app_mailbox"),
        members: countRows(database, "app_mailbox_member"),
        domain: {
          ...database.prepare("select * from app_mail_domain").get(),
        },
        domainClaimReceipt: {
          ...database
            .prepare("select * from app_mail_domain_claim_receipt")
            .get(),
        },
        organization: {
          ...database.prepare("select * from app_organization").get(),
        },
        organizationCutover: {
          ...database
            .prepare("select * from app_organization_legacy_cutover")
            .get(),
        },
        organizationAssignment: {
          ...database
            .prepare("select * from app_mailbox_legacy_organization_assignment")
            .get(),
        },
        receiptV1: countRows(
          database,
          "app_mailbox_bootstrap_receipt_v1_intent"
        ),
        receiptV2: countRows(database, "app_mailbox_bootstrap_receipt_v2"),
        receipts: countRows(database, "app_mailbox_administration_receipt"),
      }).toStrictEqual({
        addresses: 1,
        auditEvents: 1,
        canManage: true,
        guards: 0,
        mailboxes: 1,
        members: 1,
        domain: {
          canonical_domain: "example.test",
          canonicalization_profile_id:
            "mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1",
          canonicalization_version: 1,
          created_at: now,
          id: "legacy_default_v1_domain_v1",
          organization_id: "legacy_default_v1",
          status: "pending_verification",
          updated_at: now,
          version: 1,
        },
        domainClaimReceipt: {
          canonical_domain: "example.test",
          canonicalization_profile_id:
            "mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1",
          canonicalization_version: 1,
          domain_id: "legacy_default_v1_domain_v1",
          effective_at: now,
          mailbox_id: "primary",
          normalized_address_snapshot: "user-a@example.test",
          organization_id: "legacy_default_v1",
          primary_address_id: "primary",
          raw_address_snapshot: "user-a@example.test",
          schema_version: 1,
          source: "fresh-bootstrap",
          source_audit_event_id: expect.any(String),
          source_bootstrap_operation_id: "00000000-0000-4000-8000-000000000010",
        },
        organization: {
          created_at: now,
          id: "legacy_default_v1",
          status: "active",
          updated_at: now,
          version: 1,
        },
        organizationCutover: {
          id: 1,
          organization_id: null,
          outcome: "fresh-empty",
          schema_version: 1,
          source_created_at: null,
          source_mailbox_id: null,
        },
        organizationAssignment: {
          effective_at: now,
          mailbox_id: "primary",
          organization_id: "legacy_default_v1",
          schema_version: 1,
          source: "fresh-bootstrap",
        },
        receiptV1: 0,
        receiptV2: 1,
        receipts: 1,
      });
      expect(
        database
          .prepare(
            `select schema_version, event_version, operation_id, action,
                    outcome, actor_type, actor_id, tenant_scope_type,
                    tenant_scope_id, resource_type, resource_id, request_id,
                    correlation_id, reason_code, change_type,
                    resource_version_before, resource_version_after, occurred_at
               from app_administrative_audit_event`
          )
          .get()
      ).toMatchObject({
        action: "mailbox.owner-bootstrap",
        actor_id: "user-a",
        actor_type: "user",
        change_type: "mailbox-bootstrapped",
        correlation_id: requestContext.correlationId,
        event_version: 1,
        operation_id: "00000000-0000-4000-8000-000000000010",
        outcome: "succeeded",
        reason_code: "owner-bootstrap",
        request_id: requestContext.requestId,
        resource_id: "primary",
        resource_type: "mailbox",
        resource_version_after: 1,
        resource_version_before: null,
        schema_version: 1,
        tenant_scope_id: "primary",
        tenant_scope_type: "legacy-mailbox",
        occurred_at: now,
      });
      expect(
        database
          .prepare(
            `select mailbox_id, id, address, normalized_address, is_primary,
                    enabled, created_at, updated_at, version
               from app_mailbox_address`
          )
          .get()
      ).toMatchObject({
        address: "user-a@example.test",
        created_at: now,
        enabled: 1,
        id: "primary",
        is_primary: 1,
        mailbox_id: "primary",
        normalized_address: "user-a@example.test",
        updated_at: now,
        version: 1,
      });
      expect(
        database
          .prepare(
            `select role_id, scope_type, scope_id
                from auth_role_grant
               where subject_id = ? and role_id = 'owner'`
          )
          .get("user-a")
      ).toMatchObject({
        role_id: LegacyMailboxRole.owner,
        scope_id: "primary",
        scope_type: "mailbox",
      });
    } finally {
      database.close();
    }
  });

  it("materializes a staged canonical A-label domain", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);

      await Effect.runPromise(
        bootstrap(
          d1,
          validated,
          "bootstrap-guard",
          "user-a@example.test",
          "00000000-0000-4000-8000-000000000010",
          "Inbox",
          "inbox@xn--bcher-kva.example"
        )
      );

      expect(
        database.prepare("select * from app_mail_domain").get()
      ).toMatchObject({
        canonical_domain: "xn--bcher-kva.example",
        id: "legacy_default_v1_domain_v1",
        status: "pending_verification",
        version: 1,
      });
      expect(
        database
          .prepare("select * from app_mailbox_bootstrap_domain_intent")
          .get()
      ).toMatchObject({
        canonical_domain: "xn--bcher-kva.example",
        schema_version: 1,
      });
    } finally {
      database.close();
    }
  });

  it("keeps owner eligibility separate from the trusted initial address", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);

      await Effect.runPromise(
        bootstrap(
          d1,
          validated,
          "bootstrap-guard",
          "user-a@example.test",
          "00000000-0000-4000-8000-000000000010",
          "Inbox",
          "team@company.test",
          ["other@example.test", "user-a@example.test"]
        )
      );

      expect(
        database
          .prepare(
            `select address, normalized_address
               from app_mailbox_address
              where mailbox_id = 'primary' and is_primary = 1`
          )
          .get()
      ).toMatchObject({
        address: "team@company.test",
        normalized_address: "team@company.test",
      });
      expect(
        database.prepare("select * from app_mailbox_bootstrap_receipt_v2").get()
      ).toMatchObject({ initial_address: "team@company.test" });
    } finally {
      database.close();
    }
  });

  it("rejects a direct trusted-command address mismatch before writes", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);

      const error = await Effect.runPromise(
        bootstrap(
          d1,
          validated,
          "unused-guard",
          "user-a@example.test",
          "00000000-0000-4000-8000-000000000010",
          "Inbox",
          "inbox@example.test",
          ["user-a@example.test"],
          "forged@example.test"
        ).pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        operation: "bootstrap-owner",
        reason: "invalid-input",
      });
      expect({
        assignments: countRows(
          database,
          "app_mailbox_legacy_organization_assignment"
        ),
        grants: countRows(database, "auth_role_grant"),
        mailboxes: countRows(database, "app_mailbox"),
        members: countRows(database, "app_mailbox_member"),
        organizations: countRows(database, "app_organization"),
        receipts: countRows(database, "app_mailbox_administration_receipt"),
      }).toStrictEqual({
        assignments: 0,
        grants: 0,
        mailboxes: 0,
        members: 0,
        organizations: 0,
        receipts: 0,
      });
    } finally {
      database.close();
    }
  });

  it("rejects a distinct second owner bootstrap without partial writes", async () => {
    const database = new DatabaseSync(":memory:");
    const operationB = "00000000-0000-4000-8000-000000000020";

    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      await Effect.runPromise(bootstrap(d1, validated, "bootstrap-guard-a"));

      const error = await Effect.runPromise(
        bootstrap(
          d1,
          validated,
          "bootstrap-guard-b",
          "user-a@example.test",
          operationB
        ).pipe(Effect.flip)
      );

      expect(error).toBeInstanceOf(MailboxAdministrationError);
      expect(error).toMatchObject({
        operation: "bootstrap-owner",
        reason: "conflict",
      });
      expect({
        adminAudits: countRows(database, "app_administrative_audit_event"),
        authorizationGuards: countRows(database, "app_authorization_guard"),
        mailboxReceipts: countRows(
          database,
          "app_mailbox_administration_receipt"
        ),
        mailboxes: countRows(database, "app_mailbox"),
        members: countRows(database, "app_mailbox_member"),
        ownerGrants: (
          database
            .prepare(
              `select count(*) as count
                 from auth_role_grant
                where role_id = ? and scope_type = 'mailbox'
                  and scope_id = 'primary' and subject_id = 'user-a'`
            )
            .get(LegacyMailboxRole.owner) as { count: number }
        ).count,
        primaryAddresses: (
          database
            .prepare(
              `select count(*) as count
                 from app_mailbox_address
                where mailbox_id = 'primary' and is_primary = 1`
            )
            .get() as { count: number }
        ).count,
      }).toStrictEqual({
        adminAudits: 1,
        authorizationGuards: 0,
        mailboxReceipts: 1,
        mailboxes: 1,
        members: 1,
        ownerGrants: 1,
        primaryAddresses: 1,
      });
      expect(
        database
          .prepare(
            `select
               (select count(*) from app_mailbox_administration_receipt
                 where operation_id = ?) as receipts,
               (select count(*) from app_administrative_audit_event
                 where operation_id = ?) as audits`
          )
          .get(operationB, operationB)
      ).toMatchObject({ audits: 0, receipts: 0 });
    } finally {
      database.close();
    }
  });

  it("returns an exact bootstrap replay before step-up checks", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      const first = await Effect.runPromise(
        bootstrap(d1, validated, "bootstrap-guard")
      );
      database
        .prepare(
          "update auth_session set authentication_events = '[]', amr = '[]' where id = 'session-a'"
        )
        .run();

      const replay = await Effect.runPromise(
        bootstrap(d1, validated, "unused-guard")
      );

      expect(replay).toStrictEqual(first);
      expect(countRows(database, "app_administrative_audit_event")).toBe(1);
      expect(countRows(database, "app_mailbox_administration_receipt")).toBe(1);
    } finally {
      database.close();
    }
  });

  it("serializes concurrent exact bootstrap attempts into one organization and receipt", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const baseD1 = makeTestD1Database(database);
      let priorBatch: Promise<unknown> = Promise.resolve();
      const serializedD1: D1EffectQbDatabaseLike = {
        batch: (statements) => {
          const result = priorBatch.then(() => baseD1.batch(statements));
          priorBatch = result.catch(() => null);
          return result;
        },
        prepare: baseD1.prepare,
      };
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);

      const [first, second] = await Promise.all([
        Effect.runPromise(bootstrap(serializedD1, validated, "guard-a")),
        Effect.runPromise(bootstrap(serializedD1, validated, "guard-b")),
      ]);

      expect(second).toStrictEqual(first);
      expect({
        audits: countRows(database, "app_administrative_audit_event"),
        mailboxes: countRows(database, "app_mailbox"),
        organizations: countRows(database, "app_organization"),
        receipts: countRows(database, "app_mailbox_administration_receipt"),
      }).toStrictEqual({
        audits: 1,
        mailboxes: 1,
        organizations: 1,
        receipts: 1,
      });
    } finally {
      database.close();
    }
  });

  it("expands historical V1 bootstrap replay intent from the retained primary route", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrationsThrough(
        database,
        "1021_app_mail_domain.sql"
      );
      database.exec(`insert into auth_user (id, created_at, updated_at)
        values ('user-a', ${now}, ${now})`);
      seedHistoricalBootstrapReceipt(database);
      await applyControlPlaneMigration(
        database,
        "1022_app_mailbox_bootstrap_receipt_v2.sql"
      );
      await applyControlPlaneMigration(
        database,
        "1023_app_organization_legacy_cutover.sql"
      );
      database.exec(`
        insert into app_mailbox_member
          (mailbox_id, user_id, created_at, updated_at)
        values ('primary', 'user-a', ${now}, ${now});
        insert into auth_role_grant
          (subject_type, subject_id, role_id, scope_type, scope_id_present,
           scope_id)
        values ('user', 'user-a', 'owner', 'mailbox', 1, 'primary');
        insert into app_administrative_audit_event
          (event_id, schema_version, event_version, operation_id, action,
           outcome, actor_type, actor_id, tenant_scope_type, tenant_scope_id,
           resource_type, resource_id, reason_code, change_type,
           resource_version_before, resource_version_after, occurred_at)
        values ('admin-audit-sha256:${"a".repeat(64)}', 1, 1,
          '00000000-0000-4000-8000-000000000010',
          'mailbox.owner-bootstrap', 'succeeded', 'user', 'user-a',
          'legacy-mailbox', 'primary', 'mailbox', 'primary',
          'owner-bootstrap', 'mailbox-bootstrapped', null, 1, ${now});
      `);
      for (const file of [
        "1024_app_mailbox_legacy_organization_assignment.sql",
        "1025_app_organization_owner_assignment.sql",
        "1026_app_legacy_mail_domain_claim.sql",
        "1027_app_mailbox_organization.sql",
      ]) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- Migration generations are ordered.
        await applyControlPlaneMigration(database, file);
      }
      const organizationBefore = {
        ...database.prepare("select * from app_organization").get(),
      };
      database
        .prepare(
          `update app_mailbox_address
              set address = 'moved@example.test',
                  normalized_address = 'moved@example.test'
            where mailbox_id = 'primary' and id = 'primary'`
        )
        .run();
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);

      const receipt = await Effect.runPromise(readOperation(d1, validated));
      const replay = await Effect.runPromise(
        bootstrap(
          d1,
          validated,
          "unused-guard",
          "user-a@example.test",
          "00000000-0000-4000-8000-000000000010",
          "Inbox",
          "inbox@example.test"
        )
      );
      const changedAddressError = await Effect.runPromise(
        bootstrap(
          d1,
          validated,
          "unused-guard",
          "user-a@example.test",
          "00000000-0000-4000-8000-000000000010",
          "Inbox",
          "changed@example.test"
        ).pipe(Effect.flip)
      );

      expect(receipt).toMatchObject({
        operationKind: "bootstrap-owner",
        schemaVersion: 1,
      });
      expect(replay).toMatchObject({ id: "primary", version: 1 });
      expect(changedAddressError).toMatchObject({
        operation: "bootstrap-owner",
        reason: "operation-conflict",
      });
      expect({
        ...database.prepare("select * from app_organization").get(),
      }).toStrictEqual(organizationBefore);
    } finally {
      database.close();
    }
  });

  it("bridges an old-writer uppercase-domain bootstrap after cutover", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      seedHistoricalBootstrapReceipt(
        database,
        "inbox@EXAMPLE.TEST",
        "inbox@example.test"
      );
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);

      const receipt = await Effect.runPromise(readOperation(d1, validated));
      const replay = await Effect.runPromise(
        bootstrap(
          d1,
          validated,
          "unused-guard",
          "user-a@example.test",
          "00000000-0000-4000-8000-000000000010",
          "Inbox",
          "inbox@example.test"
        )
      );

      expect(receipt).toMatchObject({
        operationKind: "bootstrap-owner",
        schemaVersion: 1,
      });
      expect(receipt.initialAddress).toBeUndefined();
      expect(replay).toMatchObject({ id: "primary", version: 1 });
      expect(
        database
          .prepare("select * from app_mailbox_bootstrap_receipt_v1_intent")
          .get()
      ).toMatchObject({ initial_address: "inbox@example.test" });
      expect(countRows(database, "app_mailbox_bootstrap_receipt_v2")).toBe(0);
    } finally {
      database.close();
    }
  });

  it.each(["null", "wrong", "missing-bridge", "changed-cutover"] as const)(
    "reports receipt ancestry %s corruption as storage",
    async (corruption) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        seedHistoricalBootstrapReceipt(database);
        const validated = makeValidatedSession("user-a", "session-a");
        insertCurrentSession(database, validated);

        if (corruption === "null" || corruption === "wrong") {
          database.exec(`
            drop trigger app_mailbox_organization_immutable;
            drop trigger app_mailbox_organization_consistent_after_update;
          `);
          if (corruption === "wrong") {
            database.exec(`insert into app_organization
              (id, created_at, updated_at) values ('other', ${now}, ${now})`);
          }
          database
            .prepare(
              "update app_mailbox set organization_id = ? where id = 'primary'"
            )
            .run(corruption === "null" ? null : "other");
        } else if (corruption === "missing-bridge") {
          database.exec(`
            drop trigger app_mailbox_legacy_organization_assignment_no_delete;
            delete from app_mailbox_legacy_organization_assignment;
          `);
        } else {
          database.exec(`
            drop trigger app_organization_legacy_cutover_no_update;
            update app_organization_legacy_cutover
               set outcome = 'legacy-primary', source_mailbox_id = 'primary',
                   source_created_at = ${now},
                   organization_id = 'legacy_default_v1'
             where id = 1;
          `);
        }

        await expect(
          Effect.runPromise(
            readOperation(makeTestD1Database(database), validated)
          )
        ).rejects.toMatchObject({
          _tag: "MailboxAdministrationError",
          reason: "storage",
        });
      } finally {
        database.close();
      }
    }
  );

  it.each(["missing-both", "both-present"] as const)(
    "fails historical V1 receipt readback safely for %s intent sources",
    async (state) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrationsThrough(
          database,
          "1021_app_mail_domain.sql"
        );
        seedHistoricalBootstrapReceipt(database);
        await applyControlPlaneMigration(
          database,
          "1022_app_mailbox_bootstrap_receipt_v2.sql"
        );
        if (state === "missing-both") {
          database.exec(
            "drop trigger app_mailbox_bootstrap_receipt_v1_intent_no_delete"
          );
          database
            .prepare("delete from app_mailbox_bootstrap_receipt_v1_intent")
            .run();
        } else {
          database.exec(
            "drop trigger app_mailbox_bootstrap_receipt_v2_binding"
          );
          database.exec(
            "drop trigger app_mailbox_bootstrap_receipt_v2_promote"
          );
          database
            .prepare(
              `insert into app_mailbox_bootstrap_receipt_v2
                (operation_id, initial_address, schema_version)
               values ('00000000-0000-4000-8000-000000000010',
                       'inbox@example.test', 2)`
            )
            .run();
        }
        await expect(
          applyControlPlaneMigration(
            database,
            "1022_app_mailbox_bootstrap_receipt_v2.sql"
          )
        ).rejects.toThrow(/constraint/u);
        const d1 = makeTestD1Database(database);
        const validated = makeValidatedSession("user-a", "session-a");
        insertCurrentSession(database, validated);

        const error = await Effect.runPromise(
          readOperation(d1, validated).pipe(Effect.flip)
        );
        expect(error).toMatchObject({
          operation: "read-operation",
          reason: "storage",
        });
      } finally {
        database.close();
      }
    }
  );

  it("fails readback when a V2 companion is lost instead of downgrading", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      await Effect.runPromise(bootstrap(d1, validated, "bootstrap-guard"));
      database.exec("drop trigger app_mailbox_bootstrap_receipt_v2_no_delete");
      database.prepare("delete from app_mailbox_bootstrap_receipt_v2").run();

      await expect(
        applyControlPlaneMigration(
          database,
          "1022_app_mailbox_bootstrap_receipt_v2.sql"
        )
      ).rejects.toThrow(/constraint/u);

      const error = await Effect.runPromise(
        readOperation(d1, validated).pipe(Effect.flip)
      );
      expect(error).toMatchObject({
        operation: "read-operation",
        reason: "storage",
      });
    } finally {
      database.close();
    }
  });

  it("rejects a forged V1 bootstrap receipt on read and replay", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrationsThrough(
        database,
        "1021_app_mail_domain.sql"
      );
      seedHistoricalBootstrapReceipt(database);
      await applyControlPlaneMigration(
        database,
        "1022_app_mailbox_bootstrap_receipt_v2.sql"
      );
      database.exec(
        "drop trigger app_mailbox_administration_receipt_no_update"
      );
      database
        .prepare(
          `update app_mailbox_administration_receipt
              set result_version = 2
            where operation_id = '00000000-0000-4000-8000-000000000010'`
        )
        .run();
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);

      const readError = await Effect.runPromise(
        readOperation(d1, validated).pipe(Effect.flip)
      );
      const replayError = await Effect.runPromise(
        bootstrap(
          d1,
          validated,
          "unused-guard",
          "user-a@example.test",
          "00000000-0000-4000-8000-000000000010",
          "Inbox",
          "inbox@example.test"
        ).pipe(Effect.flip)
      );

      expect(readError).toMatchObject({ reason: "storage" });
      expect(replayError).toMatchObject({ reason: "storage" });
    } finally {
      database.close();
    }
  });

  it("rejects changed bootstrap intent reusing an operation ID", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      await Effect.runPromise(bootstrap(d1, validated, "bootstrap-guard"));

      const error = await Effect.runPromise(
        bootstrap(
          d1,
          validated,
          "unused-guard",
          "user-a@example.test",
          "00000000-0000-4000-8000-000000000010",
          "Other"
        ).pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        operation: "bootstrap-owner",
        reason: "operation-conflict",
      });
      expect(countRows(database, "app_administrative_audit_event")).toBe(1);
    } finally {
      database.close();
    }
  });

  it("treats the trusted initial address as bootstrap receipt intent", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      await Effect.runPromise(bootstrap(d1, validated, "bootstrap-guard"));

      const error = await Effect.runPromise(
        bootstrap(d1, validated, "unused-guard", "changed@example.test").pipe(
          Effect.flip
        )
      );

      expect(error).toMatchObject({
        operation: "bootstrap-owner",
        reason: "operation-conflict",
      });
      expect(
        database.prepare("select * from app_mailbox_bootstrap_receipt_v2").get()
      ).toMatchObject({
        initial_address: "user-a@example.test",
        schema_version: 2,
      });
    } finally {
      database.close();
    }
  });

  it("reads the typed receipt only for its actor", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const owner = makeValidatedSession("user-a", "session-a");
      const other = makeValidatedSession("user-b", "session-b");
      insertCurrentSession(database, owner);
      insertCurrentSession(database, other);
      await Effect.runPromise(bootstrap(d1, owner, "bootstrap-guard"));

      const receipt = await Effect.runPromise(readOperation(d1, owner));
      const error = await Effect.runPromise(
        readOperation(d1, other).pipe(Effect.flip)
      );
      const reuseError = await Effect.runPromise(
        bootstrap(d1, other, "other-guard", "user-b@example.test").pipe(
          Effect.flip
        )
      );

      expect(receipt).toMatchObject({
        actorUserId: "user-a",
        committedAt: now,
        displayName: "Inbox",
        mailboxId: "primary",
        operationKind: "bootstrap-owner",
        result: { id: "primary", version: 1 },
        initialAddress: "user-a@example.test",
        schemaVersion: 2,
      });
      expect(receipt.expectedVersion).toBeUndefined();
      expect(error).toMatchObject({
        operation: "read-operation",
        reason: "not-found",
      });
      expect(reuseError).toMatchObject({
        operation: "bootstrap-owner",
        reason: "operation-conflict",
      });
    } finally {
      database.close();
    }
  });

  it("binds receipts to mailbox state and makes them immutable", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      await Effect.runPromise(bootstrap(d1, validated, "bootstrap-guard"));

      expect(() =>
        database
          .prepare(
            "update app_mailbox_administration_receipt set result_version = result_version + 1"
          )
          .run()
      ).toThrow("mailbox administration receipts are immutable");
      expect(() =>
        database.prepare("delete from app_mailbox_administration_receipt").run()
      ).toThrow("mailbox administration receipts are retained");
      expect(() =>
        database
          .prepare(
            `insert or replace into app_mailbox_administration_receipt
             select * from app_mailbox_administration_receipt`
          )
          .run()
      ).toThrow("mailbox administration receipts are immutable");
      expect(() =>
        database
          .prepare(
            `insert into app_mailbox_administration_receipt
              (operation_id, operation_kind, actor_user_id, mailbox_id,
               display_name, expected_version, result_mailbox_id,
               result_display_name, result_status, result_created_by_user_id,
               result_created_at, result_updated_at, result_version,
               committed_at, schema_version)
             values (?, 'bootstrap-owner', 'user-a', 'primary', 'Wrong', null,
                     'primary', 'Wrong', 'active', 'user-a', ?, ?, 1, ?, 1)`
          )
          .run("00000000-0000-4000-8000-000000000099", now, now, now)
      ).toThrow("invalid mailbox administration receipt binding");
    } finally {
      database.close();
    }
  });

  it("persists the canonical trusted initial address during bootstrap", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);

      await Effect.runPromise(
        bootstrap(d1, validated, "bootstrap-guard", "user-a@EXAMPLE.TEST")
      );

      expect(
        database
          .prepare(
            `select address, normalized_address
               from app_mailbox_address
              where mailbox_id = 'primary'`
          )
          .get()
      ).toMatchObject({
        address: "user-a@example.test",
        normalized_address: "user-a@example.test",
      });
    } finally {
      database.close();
    }
  });

  it("rolls back every bootstrap write after a middle-statement failure", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      database.exec(`create trigger fail_mailbox_member
        before insert on app_mailbox_member
        begin
          select raise(abort, 'member insert failed');
        end`);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);

      const error = await Effect.runPromise(
        bootstrap(d1, validated, "bootstrap-guard").pipe(Effect.flip)
      );

      expect(error).toBeInstanceOf(MailboxAdministrationError);
      expect(error).toMatchObject({
        commitState: "unknown",
        reason: "storage",
      });
      expect({
        addresses: countRows(database, "app_mailbox_address"),
        grants: countRows(database, "auth_role_grant"),
        guards: countRows(database, "app_authorization_guard"),
        mailboxes: countRows(database, "app_mailbox"),
        members: countRows(database, "app_mailbox_member"),
        organizations: countRows(database, "app_organization"),
        receipts: countRows(database, "app_mailbox_administration_receipt"),
      }).toStrictEqual({
        addresses: 0,
        grants: 0,
        guards: 0,
        mailboxes: 0,
        members: 0,
        organizations: 0,
        receipts: 0,
      });
    } finally {
      database.close();
    }
  });

  it("rolls back every bootstrap write when its audit insert fails", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      database.exec(`create trigger fail_administrative_audit
        before insert on app_administrative_audit_event
        begin
          select raise(abort, 'audit insert failed');
        end`);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);

      const error = await Effect.runPromise(
        bootstrap(d1, validated, "bootstrap-guard").pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        commitState: "unknown",
        reason: "storage",
      });
      expect({
        addresses: countRows(database, "app_mailbox_address"),
        auditEvents: countRows(database, "app_administrative_audit_event"),
        grants: countRows(database, "auth_role_grant"),
        mailboxes: countRows(database, "app_mailbox"),
        members: countRows(database, "app_mailbox_member"),
        organizations: countRows(database, "app_organization"),
        receipts: countRows(database, "app_mailbox_administration_receipt"),
      }).toStrictEqual({
        addresses: 0,
        auditEvents: 0,
        grants: 0,
        mailboxes: 0,
        members: 0,
        organizations: 0,
        receipts: 0,
      });
    } finally {
      database.close();
    }
  });

  it.each([
    "app_mailbox_bootstrap_domain_intent",
    "app_mail_domain",
    "app_mail_domain_claim_receipt",
  ] as const)("rolls back bootstrap when ORG-009 %s fails", async (table) => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      database.exec(`create trigger fail_org009_materialization
        before insert on ${table}
        begin
          select raise(abort, 'ORG-009 failure injection');
        end`);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);

      await Effect.runPromise(
        bootstrap(d1, validated, "bootstrap-guard").pipe(Effect.flip)
      );

      expect({
        audit: countRows(database, "app_administrative_audit_event"),
        claim: countRows(database, "app_mail_domain"),
        intent: countRows(database, "app_mailbox_bootstrap_domain_intent"),
        mailbox: countRows(database, "app_mailbox"),
        receipt: countRows(database, "app_mail_domain_claim_receipt"),
      }).toStrictEqual({
        audit: 0,
        claim: 0,
        intent: 0,
        mailbox: 0,
        receipt: 0,
      });
    } finally {
      database.close();
    }
  });

  it.each([
    ["organization member", "app_organization_member", "1"],
    [
      "organization owner grant",
      "auth_role_grant",
      "new.role_id = 'organization.owner'",
    ],
    [
      "organization owner receipt",
      "app_organization_owner_assignment_receipt",
      "1",
    ],
  ] as const)(
    "rolls back the full bootstrap batch when the %s insert fails",
    async (_, table, condition) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        database.exec(`create trigger fail_org008_target
          before insert on ${table}
          when ${condition}
          begin
            select raise(abort, 'ORG-008 target insert failed');
          end`);
        const d1 = makeTestD1Database(database);
        const validated = makeValidatedSession("user-a", "session-a");
        insertCurrentSession(database, validated);

        const error = await Effect.runPromise(
          bootstrap(d1, validated, "bootstrap-guard").pipe(Effect.flip)
        );

        expect(error).toMatchObject({
          commitState: "unknown",
          reason: "storage",
        });
        expect({
          addresses: countRows(database, "app_mailbox_address"),
          audits: countRows(database, "app_administrative_audit_event"),
          grants: countRows(database, "auth_role_grant"),
          mailboxMembers: countRows(database, "app_mailbox_member"),
          mailboxes: countRows(database, "app_mailbox"),
          organizationMembers: countRows(database, "app_organization_member"),
          organizations: countRows(database, "app_organization"),
          ownerReceipts: countRows(
            database,
            "app_organization_owner_assignment_receipt"
          ),
        }).toStrictEqual({
          addresses: 0,
          audits: 0,
          grants: 0,
          mailboxMembers: 0,
          mailboxes: 0,
          organizationMembers: 0,
          organizations: 0,
          ownerReceipts: 0,
        });
      } finally {
        database.close();
      }
    }
  );

  it("accepts semantically equivalent authentication event JSON", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      database
        .prepare(
          "update auth_session set authentication_events = ? where id = ?"
        )
        .run(
          JSON.stringify([recentPasswordEvent], undefined, 2),
          validated.actor.sessionId
        );

      const mailbox = await Effect.runPromise(
        bootstrap(d1, validated, "bootstrap-guard")
      );

      expect(mailbox.id).toBe("primary");
    } finally {
      database.close();
    }
  });

  it.each([
    [
      "TOTP",
      {
        acceptedCounter: 1,
        factorId: CredentialId("factor-a"),
        type: "totp",
        verifiedAt: UnixMillis(stepUpNow),
        version: 1,
      },
    ],
    [
      "UV passkey",
      {
        credentialId: CredentialId("credential-a"),
        type: "passkey",
        userVerification: "verified",
        verifiedAt: UnixMillis(stepUpNow),
        version: 1,
      },
    ],
  ] as const)("accepts transactional %s evidence", async (_, event) => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a", undefined, [
        event,
      ]);
      insertCurrentSession(database, validated);

      const mailbox = await Effect.runPromise(
        bootstrap(d1, validated, "bootstrap-guard")
      );

      expect(mailbox.id).toBe("primary");
    } finally {
      database.close();
    }
  });

  it("rejects owner bootstrap from a session with unmet requirements", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      const claims = { requirements: ["email_verification"] } as const;
      const limited = {
        ...validated,
        currentSession: { ...validated.currentSession, claims },
        issued: { ...validated.issued, claims },
      } satisfies ValidatedSession;
      insertCurrentSession(database, limited);

      const error = await Effect.runPromise(
        bootstrap(d1, limited, "bootstrap-guard").pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        operation: "bootstrap-owner",
        reason: "session-recheck",
      });
      expect({
        grants: countRows(database, "auth_role_grant"),
        mailboxes: countRows(database, "app_mailbox"),
        members: countRows(database, "app_mailbox_member"),
        organizations: countRows(database, "app_organization"),
      }).toStrictEqual({
        grants: 0,
        mailboxes: 0,
        members: 0,
        organizations: 0,
      });
    } finally {
      database.close();
    }
  });

  it.each([
    ["no authentication evidence", []],
    [
      "stale password evidence",
      [
        {
          credentialId: CredentialId("credential-a"),
          type: "password",
          verifiedAt: UnixMillis(
            stepUpNow - CONTROL_PLANE_STEP_UP_POLICY.maxAgeMs - 1
          ),
          version: 1,
        },
      ],
    ],
    [
      "email OTP evidence",
      [
        {
          identityId: "identity-a",
          type: "email_otp",
          verifiedAt: UnixMillis(stepUpNow),
          version: 1,
        },
      ],
    ],
  ] as const)(
    "requires step-up for owner bootstrap with %s",
    async (_, events) => {
      const database = new DatabaseSync(":memory:");

      try {
        await applyControlPlaneMigrations(database);
        const d1 = makeTestD1Database(database);
        const validated = makeValidatedSession(
          "user-a",
          "session-a",
          undefined,
          events
        );
        insertCurrentSession(database, validated);

        const error = await Effect.runPromise(
          bootstrap(d1, validated, "bootstrap-guard").pipe(Effect.flip)
        );

        expect(error).toMatchObject({
          operation: "bootstrap-owner",
          reason: "step-up-required",
        });
        expect({
          addresses: countRows(database, "app_mailbox_address"),
          grants: countRows(database, "auth_role_grant"),
          mailboxes: countRows(database, "app_mailbox"),
          members: countRows(database, "app_mailbox_member"),
        }).toStrictEqual({ addresses: 0, grants: 0, mailboxes: 0, members: 0 });
      } finally {
        database.close();
      }
    }
  );

  it("rechecks fresh evidence inside the bootstrap batch", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const baseD1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      const staleD1: D1EffectQbDatabaseLike = {
        batch: (statements) => {
          database
            .prepare(
              "update auth_session set authentication_events = '[]' where id = ?"
            )
            .run(validated.actor.sessionId);
          return baseD1.batch(statements);
        },
        prepare: baseD1.prepare,
      };

      const error = await Effect.runPromise(
        bootstrap(staleD1, validated, "bootstrap-guard").pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        operation: "bootstrap-owner",
        reason: "step-up-required",
      });
      expect(countRows(database, "app_mailbox")).toBe(0);
    } finally {
      database.close();
    }
  });

  it("rechecks session expiry against database execution time", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const baseD1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      const expiredD1: D1EffectQbDatabaseLike = {
        batch: (statements) => {
          database
            .prepare("update auth_session set expires_at = ? where id = ?")
            .run(now + 1, validated.actor.sessionId);
          return baseD1.batch(statements);
        },
        prepare: baseD1.prepare,
      };

      const error = await Effect.runPromise(
        bootstrap(expiredD1, validated, "bootstrap-guard").pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        operation: "bootstrap-owner",
        reason: "session-recheck",
      });
      expect(countRows(database, "app_mailbox")).toBe(0);
    } finally {
      database.close();
    }
  });

  it.each([
    [
      "application mutation clock",
      [{ ...recentPasswordEvent, verifiedAt: UnixMillis(now) }],
    ],
    ["unknown evidence version", [{ ...recentPasswordEvent, version: 2 }]],
    [
      "malformed password evidence",
      [{ type: "password", verifiedAt: stepUpNow, version: 1 }],
    ],
    [
      "malformed TOTP evidence",
      [
        {
          factorId: "factor-a",
          type: "totp",
          verifiedAt: stepUpNow,
          version: 1,
        },
      ],
    ],
    [
      "non-UV passkey evidence",
      [
        {
          credentialId: "credential-a",
          type: "passkey",
          userVerification: "not-verified",
          verifiedAt: stepUpNow,
          version: 1,
        },
      ],
    ],
    [
      "future evidence",
      [{ ...recentPasswordEvent, verifiedAt: stepUpNow + 60_000 }],
    ],
    [
      "fractional evidence timestamp",
      [{ ...recentPasswordEvent, verifiedAt: stepUpNow - 0.5 }],
    ],
    [
      "negative TOTP counter",
      [
        {
          acceptedCounter: -1,
          factorId: "factor-a",
          type: "totp",
          verifiedAt: stepUpNow,
          version: 1,
        },
      ],
    ],
    [
      "negative passkey sign count",
      [
        {
          credentialId: "credential-a",
          signCount: -1,
          type: "passkey",
          userVerification: "verified",
          verifiedAt: stepUpNow,
          version: 1,
        },
      ],
    ],
    [
      "oversized evidence array",
      Array.from(
        { length: 33 },
        (_, index) =>
          ({
            ...recentPasswordEvent,
            credentialId: CredentialId(`credential-${index}`),
          }) as const
      ),
    ],
    ["object evidence container", recentPasswordEvent],
  ] as const)(
    "rejects transactional evidence using %s",
    async (_, evidence) => {
      const database = new DatabaseSync(":memory:");

      try {
        await applyControlPlaneMigrations(database);
        const baseD1 = makeTestD1Database(database);
        const validated = makeValidatedSession("user-a", "session-a");
        insertCurrentSession(database, validated);
        const changedD1: D1EffectQbDatabaseLike = {
          batch: (statements) => {
            database
              .prepare(
                "update auth_session set authentication_events = ? where id = ?"
              )
              .run(JSON.stringify(evidence), validated.actor.sessionId);
            return baseD1.batch(statements);
          },
          prepare: baseD1.prepare,
        };

        const error = await Effect.runPromise(
          bootstrap(changedD1, validated, "bootstrap-guard").pipe(Effect.flip)
        );

        expect(error).toMatchObject({
          operation: "bootstrap-owner",
          reason: "step-up-required",
        });
        expect(countRows(database, "app_mailbox")).toBe(0);
        expect(countRows(database, "app_administrative_audit_event")).toBe(0);
      } finally {
        database.close();
      }
    }
  );

  it("does not let an unconfigured actor take ownership", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const first = makeValidatedSession("user-a", "session-a");
      const second = makeValidatedSession("user-b", "session-b");
      insertCurrentSession(database, first);
      insertCurrentSession(database, second);

      const error = await Effect.runPromise(
        bootstrap(d1, second, "bootstrap-guard-b").pipe(Effect.flip)
      );

      expect(error).toMatchObject({ reason: "owner-not-eligible" });
      expect({
        auditEvents: countRows(database, "app_administrative_audit_event"),
        mailboxes: countRows(database, "app_mailbox"),
      }).toStrictEqual({ auditEvents: 0, mailboxes: 0 });
      await Effect.runPromise(bootstrap(d1, first, "bootstrap-guard-a"));
      expect(
        database
          .prepare("select created_by_user_id from app_mailbox where id = ?")
          .get("primary")
      ).toMatchObject({ created_by_user_id: "user-a" });
      expect(
        database
          .prepare(
            `select count(*) as count
               from auth_role_grant
              where subject_id = 'user-b'`
          )
          .get()
      ).toMatchObject({ count: 0 });
      expect(
        database
          .prepare(
            `select count(*) as count
               from app_mailbox_member
              where user_id = 'user-b'`
          )
          .get()
      ).toMatchObject({ count: 0 });
    } finally {
      database.close();
    }
  });

  it.each([
    ["unverified", "verified_at = null"],
    ["revoked", "revoked_at = 1500"],
    ["replaced", "replaced_by_id = 'replacement-identity'"],
  ] as const)(
    "rejects a configured but %s owner identity",
    async (_, update) => {
      const database = new DatabaseSync(":memory:");

      try {
        await applyControlPlaneMigrations(database);
        const d1 = makeTestD1Database(database);
        const validated = makeValidatedSession("user-a", "session-a");
        insertCurrentSession(database, validated);
        database.exec(`update auth_user_identity set ${update}`);

        const error = await Effect.runPromise(
          bootstrap(d1, validated, "bootstrap-guard").pipe(Effect.flip)
        );

        expect(error).toMatchObject({ reason: "owner-not-eligible" });
        expect(countRows(database, "app_mailbox")).toBe(0);
      } finally {
        database.close();
      }
    }
  );

  it("renames only after policy and transactional permission checks succeed", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      await Effect.runPromise(bootstrap(d1, validated, "bootstrap-guard"));
      const mailAuthorizationLive = MailboxAuthorizationApplicationLayer.pipe(
        Layer.provide(
          Layer.merge(
            MailPermissionsEffectAuthLayer.pipe(
              Layer.provide(D1EffectQbSqliteAuthStorageLive(d1))
            ),
            makeResolverLive()
          )
        )
      );

      const mailbox = await Effect.runPromise(
        rename(d1, validated, mailAuthorizationLive, "primary", "Recruiting")
      );

      expect(mailbox).toMatchObject({
        displayName: "Recruiting",
        id: "primary",
        version: 2,
      });
      expect(countRows(database, "app_authorization_guard")).toBe(0);
      expect(
        database
          .prepare(
            `select action, change_type, resource_version_before,
                    resource_version_after
               from app_administrative_audit_event
              where action = 'mailbox.rename'`
          )
          .get()
      ).toMatchObject({
        action: "mailbox.rename",
        change_type: "mailbox-renamed",
        resource_version_after: 2,
        resource_version_before: 1,
      });
    } finally {
      database.close();
    }
  });

  it("returns an exact rename replay before permission checks", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      await Effect.runPromise(bootstrap(d1, validated, "bootstrap-guard"));
      const mailAuthorizationLive = MailboxAuthorizationApplicationLayer.pipe(
        Layer.provide(
          Layer.merge(
            MailPermissionsEffectAuthLayer.pipe(
              Layer.provide(D1EffectQbSqliteAuthStorageLive(d1))
            ),
            makeResolverLive()
          )
        )
      );
      const first = await Effect.runPromise(
        rename(d1, validated, mailAuthorizationLive, "primary", "Recruiting")
      );
      database
        .prepare("update auth_role_grant set revoked_at = ?")
        .run(now + 500);

      const replay = await Effect.runPromise(
        rename(
          d1,
          validated,
          unavailableMailAuthorizationLive,
          "primary",
          "Recruiting"
        )
      );
      const receipt = await Effect.runPromise(
        readOperation(d1, validated, "00000000-0000-4000-8000-000000000011")
      );

      expect(replay).toStrictEqual(first);
      expect(receipt).toMatchObject({
        operationKind: "rename",
        schemaVersion: 1,
      });
      expect(receipt.initialAddress).toBeUndefined();
      expect(countRows(database, "app_administrative_audit_event")).toBe(2);
      expect(countRows(database, "app_mailbox_administration_receipt")).toBe(2);
    } finally {
      database.close();
    }
  });

  it("treats expectedVersion as part of rename operation intent", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      await Effect.runPromise(bootstrap(d1, validated, "bootstrap-guard"));
      const mailAuthorizationLive = MailboxAuthorizationApplicationLayer.pipe(
        Layer.provide(
          Layer.merge(
            MailPermissionsEffectAuthLayer.pipe(
              Layer.provide(D1EffectQbSqliteAuthStorageLive(d1))
            ),
            makeResolverLive()
          )
        )
      );
      await Effect.runPromise(
        rename(d1, validated, mailAuthorizationLive, "primary", "Recruiting")
      );

      const error = await Effect.runPromise(
        rename(
          d1,
          validated,
          mailAuthorizationLive,
          "primary",
          "Recruiting",
          2
        ).pipe(Effect.flip)
      );

      expect(error).toMatchObject({ reason: "operation-conflict" });
      expect(
        database.prepare("select display_name, version from app_mailbox").get()
      ).toMatchObject({ display_name: "Recruiting", version: 2 });
    } finally {
      database.close();
    }
  });

  it("rolls back rename and receipt when its audit insert fails", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      await Effect.runPromise(bootstrap(d1, validated, "bootstrap-guard"));
      database.exec(`create trigger fail_mailbox_rename_audit
        before insert on app_administrative_audit_event
        when new.action = 'mailbox.rename'
        begin
          select raise(abort, 'rename audit failed');
        end`);
      const mailAuthorizationLive = MailboxAuthorizationApplicationLayer.pipe(
        Layer.provide(
          Layer.merge(
            MailPermissionsEffectAuthLayer.pipe(
              Layer.provide(D1EffectQbSqliteAuthStorageLive(d1))
            ),
            makeResolverLive()
          )
        )
      );

      const error = await Effect.runPromise(
        rename(
          d1,
          validated,
          mailAuthorizationLive,
          "primary",
          "Recruiting"
        ).pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        commitState: "unknown",
        operation: "rename",
        reason: "storage",
      });
      expect(
        database.prepare("select display_name, version from app_mailbox").get()
      ).toMatchObject({ display_name: "Inbox", version: 1 });
      expect(countRows(database, "app_mailbox_administration_receipt")).toBe(1);
      expect(countRows(database, "app_administrative_audit_event")).toBe(1);
    } finally {
      database.close();
    }
  });

  it("rejects changed rename intent reusing an operation ID", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      await Effect.runPromise(bootstrap(d1, validated, "bootstrap-guard"));
      const mailAuthorizationLive = MailboxAuthorizationApplicationLayer.pipe(
        Layer.provide(
          Layer.merge(
            MailPermissionsEffectAuthLayer.pipe(
              Layer.provide(D1EffectQbSqliteAuthStorageLive(d1))
            ),
            makeResolverLive()
          )
        )
      );
      await Effect.runPromise(
        rename(d1, validated, mailAuthorizationLive, "primary", "Recruiting")
      );

      const error = await Effect.runPromise(
        rename(
          d1,
          validated,
          mailAuthorizationLive,
          "primary",
          "Sales",
          2,
          "00000000-0000-4000-8000-000000000011"
        ).pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        operation: "rename",
        reason: "operation-conflict",
      });
      expect(
        database.prepare("select display_name, version from app_mailbox").get()
      ).toMatchObject({ display_name: "Recruiting", version: 2 });
      expect(
        database
          .prepare(
            `select count(*) as count from app_administrative_audit_event
              where action = 'mailbox.rename'`
          )
          .get()
      ).toMatchObject({ count: 1 });
    } finally {
      database.close();
    }
  });

  it("does not require fresh step-up for a mailbox display-name rename", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const elevated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, elevated);
      await Effect.runPromise(bootstrap(d1, elevated, "bootstrap-guard"));
      const ordinary = makeValidatedSession(
        "user-a",
        "session-a",
        undefined,
        []
      );
      database
        .prepare(
          `update auth_session
              set authentication_events = ?, auth_time = ?, amr = ?
            where id = ?`
        )
        .run(
          JSON.stringify(ordinary.issued.authenticationEvents),
          ordinary.issued.authTime,
          JSON.stringify(ordinary.issued.amr),
          ordinary.issued.sessionId
        );
      const mailAuthorizationLive = MailboxAuthorizationApplicationLayer.pipe(
        Layer.provide(
          Layer.merge(
            MailPermissionsEffectAuthLayer.pipe(
              Layer.provide(D1EffectQbSqliteAuthStorageLive(d1))
            ),
            makeResolverLive()
          )
        )
      );

      const mailbox = await Effect.runPromise(
        rename(d1, ordinary, mailAuthorizationLive, "primary", "Recruiting")
      );

      expect(mailbox).toMatchObject({ displayName: "Recruiting", version: 2 });
    } finally {
      database.close();
    }
  });

  it("denies a mutation when its role is revoked after the policy check", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      await Effect.runPromise(bootstrap(d1, validated, "bootstrap-guard"));
      const mailAuthorizationLive = makePermissionRaceLive(() => {
        database
          .prepare(
            `update auth_role_grant
                set revoked_at = ?
              where subject_id = ? and role_id = ?`
          )
          .run(now + 500, "user-a", LegacyMailboxRole.owner);
      });

      const error = await Effect.runPromise(
        rename(
          d1,
          validated,
          mailAuthorizationLive,
          "primary",
          "Attacker Name"
        ).pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        operation: "rename",
        reason: "authorization-recheck",
      });
      expect(
        database
          .prepare("select display_name from app_mailbox where id = ?")
          .get("primary")
      ).toMatchObject({ display_name: "Inbox" });
      expect(countRows(database, "app_administrative_audit_event")).toBe(1);
    } finally {
      database.close();
    }
  });

  it("denies a mutation when its role grant expires before the D1 batch", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      await Effect.runPromise(bootstrap(d1, validated, "bootstrap-guard"));
      const mailAuthorizationLive = makePermissionRaceLive(() => {
        database
          .prepare(
            `update auth_role_grant
                set expires_at = ?
              where subject_id = ? and role_id = ?`
          )
          .run(Date.now() - 1, "user-a", LegacyMailboxRole.owner);
      });

      const error = await Effect.runPromise(
        rename(
          d1,
          validated,
          mailAuthorizationLive,
          "primary",
          "Attacker Name"
        ).pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        operation: "rename",
        reason: "authorization-recheck",
      });
      expect(
        database
          .prepare("select display_name from app_mailbox where id = ?")
          .get("primary")
      ).toMatchObject({ display_name: "Inbox" });
      expect(countRows(database, "app_mailbox_administration_receipt")).toBe(1);
      expect(countRows(database, "app_administrative_audit_event")).toBe(1);
    } finally {
      database.close();
    }
  });

  it("denies a mutation when its session is revoked after the policy check", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      await Effect.runPromise(bootstrap(d1, validated, "bootstrap-guard"));
      const mailAuthorizationLive = makePermissionRaceLive(() => {
        database
          .prepare("update auth_session set revoked_at = ? where id = ?")
          .run(now + 500, "session-a");
      });

      const error = await Effect.runPromise(
        rename(
          d1,
          validated,
          mailAuthorizationLive,
          "primary",
          "Attacker Name"
        ).pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        operation: "rename",
        reason: "session-recheck",
      });
      expect(
        database
          .prepare("select display_name from app_mailbox where id = ?")
          .get("primary")
      ).toMatchObject({ display_name: "Inbox" });
    } finally {
      database.close();
    }
  });

  it("denies a mutation when its session expires before the D1 batch", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      await Effect.runPromise(bootstrap(d1, validated, "bootstrap-guard"));
      const mailAuthorizationLive = makePermissionRaceLive(() => {
        database
          .prepare("update auth_session set expires_at = ? where id = ?")
          .run(Date.now() - 1, "session-a");
      });

      const error = await Effect.runPromise(
        rename(
          d1,
          validated,
          mailAuthorizationLive,
          "primary",
          "Attacker Name"
        ).pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        operation: "rename",
        reason: "session-recheck",
      });
      expect(
        database
          .prepare("select display_name from app_mailbox where id = ?")
          .get("primary")
      ).toMatchObject({ display_name: "Inbox" });
      expect(countRows(database, "app_mailbox_administration_receipt")).toBe(1);
      expect(countRows(database, "app_administrative_audit_event")).toBe(1);
    } finally {
      database.close();
    }
  });

  it("keeps guard authorization authoritative after session and grant expiry", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const baseD1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      await Effect.runPromise(bootstrap(baseD1, validated, "bootstrap-guard"));
      const expiresAt = Date.now() + 60_000;
      database
        .prepare("update auth_session set expires_at = ? where id = ?")
        .run(expiresAt, "session-a");
      database
        .prepare(
          `update auth_role_grant
              set expires_at = ?
            where subject_id = ? and role_id = ?`
        )
        .run(expiresAt, "user-a", LegacyMailboxRole.owner);
      const mailAuthorizationLive = MailboxAuthorizationApplicationLayer.pipe(
        Layer.provide(
          Layer.merge(
            MailPermissionsEffectAuthLayer.pipe(
              Layer.provide(D1EffectQbSqliteAuthStorageLive(baseD1))
            ),
            makeResolverLive()
          )
        )
      );
      const movingTimeD1 = withDatabaseTimes(baseD1, [
        expiresAt - 1,
        expiresAt + 1,
      ]);

      const mailbox = await Effect.runPromise(
        rename(
          movingTimeD1,
          validated,
          mailAuthorizationLive,
          "primary",
          "Recruiting"
        )
      );
      const replay = await Effect.runPromise(
        rename(
          baseD1,
          validated,
          unavailableMailAuthorizationLive,
          "primary",
          "Recruiting"
        )
      );

      expect(mailbox).toMatchObject({ displayName: "Recruiting", version: 2 });
      expect(replay).toStrictEqual(mailbox);
      expect(countRows(database, "app_mailbox_administration_receipt")).toBe(2);
      expect(countRows(database, "app_administrative_audit_event")).toBe(2);
      expect(countRows(database, "app_authorization_guard")).toBe(0);
    } finally {
      database.close();
    }
  });

  it("denies a same-millisecond session rotation after the policy check", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a", 1500);
      insertCurrentSession(database, validated);
      await Effect.runPromise(bootstrap(d1, validated, "bootstrap-guard"));
      const mailAuthorizationLive = makePermissionRaceLive(() => {
        database
          .prepare(
            `update auth_session
                set secret_hash = 'rotated-hash', rotated_at = ?
              where id = ?`
          )
          .run(1500, "session-a");
      });

      const error = await Effect.runPromise(
        rename(
          d1,
          validated,
          mailAuthorizationLive,
          "primary",
          "Attacker Name"
        ).pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        operation: "rename",
        reason: "session-recheck",
      });
      expect(
        database
          .prepare("select display_name from app_mailbox where id = ?")
          .get("primary")
      ).toMatchObject({ display_name: "Inbox" });
      expect(countRows(database, "app_mailbox_administration_receipt")).toBe(1);
      expect(countRows(database, "app_administrative_audit_event")).toBe(1);
    } finally {
      database.close();
    }
  });

  it("denies a dangling recovery capability added after the policy check", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      await Effect.runPromise(bootstrap(d1, validated, "bootstrap-guard"));
      const mailAuthorizationLive = makePermissionRaceLive(() => {
        database
          .prepare("update auth_session set metadata = ? where id = ?")
          .run(
            JSON.stringify({
              __effectAuthSession: {
                claims: {
                  recoveryRemediation: { allowed: ["second-passkey"] },
                  requirements: [],
                },
                version: 1,
              },
            }),
            "session-a"
          );
      });

      const error = await Effect.runPromise(
        rename(
          d1,
          validated,
          mailAuthorizationLive,
          "primary",
          "Attacker Name"
        ).pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        operation: "rename",
        reason: "session-recheck",
      });
      expect(
        database
          .prepare("select display_name from app_mailbox where id = ?")
          .get("primary")
      ).toMatchObject({ display_name: "Inbox" });
      expect(countRows(database, "app_mailbox_administration_receipt")).toBe(1);
      expect(countRows(database, "app_administrative_audit_event")).toBe(1);
    } finally {
      database.close();
    }
  });

  it("recovers a committed result when D1 reports an unknown commit state", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const baseD1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      let batches = 0;
      const ambiguousD1: D1EffectQbDatabaseLike = {
        batch: async (statements) => {
          batches += 1;
          await baseD1.batch(statements);
          throw new Error("Response lost after commit");
        },
        prepare: baseD1.prepare,
      };

      const mailbox = await Effect.runPromise(
        bootstrap(ambiguousD1, validated, "bootstrap-guard")
      );

      expect(mailbox).toMatchObject({ id: "primary", version: 1 });
      expect(batches).toBe(1);
      expect({
        addresses: countRows(database, "app_mailbox_address"),
        grants: countRows(database, "auth_role_grant"),
        guards: countRows(database, "app_authorization_guard"),
        mailboxes: countRows(database, "app_mailbox"),
        members: countRows(database, "app_mailbox_member"),
        organizations: countRows(database, "app_organization"),
      }).toStrictEqual({
        addresses: 1,
        grants: 2,
        guards: 0,
        mailboxes: 1,
        members: 1,
        organizations: 1,
      });
    } finally {
      database.close();
    }
  });

  it("keeps the authorization guard decision authoritative", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const baseD1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      const boundaryD1: D1EffectQbDatabaseLike = {
        batch: async (statements) => {
          const results = await baseD1.batch(statements);
          return results.map((result, index) =>
            index === 1
              ? {
                  ...result,
                  results: [
                    {
                      authorized: 1,
                      base_session_valid: 0,
                      catalog_valid: 0,
                      mailbox_available: 0,
                      operation_available: 0,
                      owner_eligible: 0,
                      step_up_valid: 0,
                    },
                  ],
                }
              : result
          );
        },
        prepare: baseD1.prepare,
      };

      const mailbox = await Effect.runPromise(
        bootstrap(boundaryD1, validated, "bootstrap-guard")
      );

      expect(mailbox.id).toBe("primary");
      expect(countRows(database, "app_mailbox")).toBe(1);
    } finally {
      database.close();
    }
  });

  it("reports missing required batch rows as storage failure after commit", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const baseD1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      const missingStatusD1: D1EffectQbDatabaseLike = {
        batch: async (statements) => {
          const results = await baseD1.batch(statements);
          return results.map((result, index) =>
            index === 1 ? { ...result, results: undefined } : result
          );
        },
        prepare: baseD1.prepare,
      };

      const error = await Effect.runPromise(
        bootstrap(missingStatusD1, validated, "bootstrap-guard").pipe(
          Effect.flip
        )
      );

      expect(error).toMatchObject({
        commitState: "unknown",
        operation: "bootstrap-owner",
        reason: "storage",
      });
      expect({
        addresses: countRows(database, "app_mailbox_address"),
        grants: countRows(database, "auth_role_grant"),
        mailboxes: countRows(database, "app_mailbox"),
        members: countRows(database, "app_mailbox_member"),
      }).toStrictEqual({ addresses: 1, grants: 2, mailboxes: 1, members: 1 });
    } finally {
      database.close();
    }
  });
});
