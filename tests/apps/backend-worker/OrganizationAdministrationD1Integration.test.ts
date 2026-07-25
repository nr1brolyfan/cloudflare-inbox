/* oxlint-disable vitest/max-expects -- Integration cases verify atomic lifecycle state. */
import { DatabaseSync } from "node:sqlite";

import type { D1EffectQbDatabaseLike } from "@effect-auth/core/EffectQbSqliteStorage";
import {
  CredentialId,
  SessionId,
  SessionToken,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import * as AuthPermission from "@effect-auth/core/Permission";
import type { ValidatedSession } from "@effect-auth/core/Sessions";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  OrganizationAdministrationD1Layer,
  OrganizationAdministrationRuntime,
} from "#/apps/backend-worker/OrganizationAdministrationD1Integration";
import { SensitiveOperationStepUpClock } from "#/modules/account-security/ports/SensitiveOperationStepUpClock";
import { AdministrativeAudit } from "#/modules/administrative-audit/contracts/AdministrativeAudit";
import { AdministrativeAuditRuntimeLayer } from "#/modules/administrative-audit/layers/AdministrativeAuditLayer";
import {
  OrganizationAdministration,
  OrganizationAdministrationError,
  ResumeOrganizationCommand,
  SuspendOrganizationCommand,
} from "#/modules/organization/application/OrganizationAdministration";
import { ControlPlaneD1Layer } from "#/platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneD1Binding } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import { CurrentRequestAuth } from "#/shared/RequestAuth";
import {
  CurrentRequestCorrelation,
  RequestCorrelation,
} from "#/shared/RequestCorrelation";

import {
  activateOrganizationLifecycleProtocol,
  applyControlPlaneMigrations,
  makeTestD1Database,
} from "../../support/d1";

const stepUpNow = Date.now();
const requestContext = Schema.decodeUnknownSync(RequestCorrelation)({
  correlationId: "00000000-0000-4000-8000-000000000002",
  requestId: "00000000-0000-4000-8000-000000000001",
});

const makeValidatedSession = (withStepUp = true): ValidatedSession => {
  const userId = UserId("user-a");
  const sessionId = SessionId("session-a");
  const authenticationEvents = withStepUp
    ? [
        {
          credentialId: CredentialId("credential-a"),
          type: "password" as const,
          verifiedAt: UnixMillis(stepUpNow - 100),
          version: 1 as const,
        },
      ]
    : [];
  const currentSession = {
    aal: "aal1" as const,
    amr: withStepUp ? (["pwd"] as const) : [],
    authenticationEvents,
    authTime: UnixMillis(withStepUp ? stepUpNow - 100 : 1000),
    expiresAt: UnixMillis(stepUpNow + 60 * 60 * 1000),
    sessionId,
    userId,
  };
  return {
    actor: { sessionId, userId },
    currentSession,
    issued: {
      ...currentSession,
      token: SessionToken("session-a.secret"),
    },
  };
};

const seedAuthority = (
  database: DatabaseSync,
  validated: ValidatedSession,
  scope: "global" | "organization" = "organization",
  activate = true
) => {
  database
    .prepare(
      `insert into auth_user (id, created_at, updated_at)
       values (?, 1000, 1000)`
    )
    .run(validated.actor.userId);
  database
    .prepare(
      `insert into auth_session
        (id, user_id, secret_hash, created_at, expires_at, auth_time,
         authentication_events, aal, amr, rotated_at)
       values (?, ?, 'hash', 1000, ?, ?, ?, ?, ?, null)`
    )
    .run(
      validated.actor.sessionId,
      validated.actor.userId,
      validated.issued.expiresAt,
      validated.issued.authTime,
      JSON.stringify(validated.issued.authenticationEvents),
      validated.issued.aal,
      JSON.stringify(validated.issued.amr)
    );
  database.exec(`
    insert into app_organization (id, created_at, updated_at)
    values ('organization-a', 1000, 1000);
    insert into app_organization_member
      (id, organization_id, user_id, created_at, updated_at)
    values ('membership-a', 'organization-a', 'user-a', 1000, 1000);
    insert into auth_role_grant
      (subject_type, subject_id, role_id, scope_type, scope_id_present,
       scope_id, expires_at, metadata, revoked_at)
    values ('user', 'user-a', 'organization.owner', '${scope}',
            ${scope === "global" ? 0 : 1},
            '${scope === "global" ? "" : "organization-a"}', null, null, null);
  `);
  if (activate) {
    activateOrganizationLifecycleProtocol(database);
  }
};

const controlPlaneLayer = (database: D1EffectQbDatabaseLike) =>
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

const runAdministration = <A, E>(
  database: D1EffectQbDatabaseLike,
  validated: ValidatedSession,
  effect: Effect.Effect<
    A,
    E,
    | OrganizationAdministration
    | AuthPermission.CurrentPrincipal
    | CurrentRequestAuth
    | RequestCorrelation
  >
) =>
  effect.pipe(
    Effect.provide(
      OrganizationAdministrationD1Layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            AdministrativeAudit.layerNoDeps.pipe(
              Layer.provide(AdministrativeAuditRuntimeLayer)
            ),
            Layer.succeed(
              OrganizationAdministrationRuntime,
              OrganizationAdministrationRuntime.of({
                now: () => 2000,
                randomId: () => "authorization-nonce",
              })
            ),
            Layer.succeed(
              SensitiveOperationStepUpClock,
              SensitiveOperationStepUpClock.of({ now: () => stepUpNow })
            )
          )
        ),
        Layer.provide(controlPlaneLayer(database))
      )
    ),
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

describe("OrganizationAdministration D1", () => {
  it("keeps lifecycle writes disabled before live protocol activation", async () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(sqlite);
      const validated = makeValidatedSession();
      seedAuthority(sqlite, validated, "organization", false);
      const exit = await Effect.runPromiseExit(
        runAdministration(
          makeTestD1Database(sqlite),
          validated,
          Effect.gen(function* () {
            const administration = yield* OrganizationAdministration;
            return yield* administration.suspend(
              Schema.decodeUnknownSync(SuspendOrganizationCommand)({
                expectedVersion: 1,
                operationId: "00000000-0000-4000-8000-000000000009",
                organizationId: "organization-a",
              })
            );
          })
        )
      );
      expect(Exit.isFailure(exit)).toBeTruthy();
      const failure = Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
      expect(failure).toBeInstanceOf(OrganizationAdministrationError);
      expect((failure as OrganizationAdministrationError).reason).toBe(
        "conflict"
      );
      expect(
        sqlite
          .prepare(
            "select status from app_organization_lifecycle_activation where id = 1"
          )
          .get()
      ).toMatchObject({ status: "expanded" });
    } finally {
      sqlite.close();
    }
  });

  it("suspends, replays, resumes, and writes exact audit receipts", async () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(sqlite);
      const validated = makeValidatedSession();
      seedAuthority(sqlite, validated);
      const database = makeTestD1Database(sqlite);

      const suspend = Effect.gen(function* () {
        const administration = yield* OrganizationAdministration;
        return yield* administration.suspend(
          Schema.decodeUnknownSync(SuspendOrganizationCommand)({
            expectedVersion: 1,
            operationId: "00000000-0000-4000-8000-000000000010",
            organizationId: "organization-a",
          })
        );
      });
      const suspended = await Effect.runPromise(
        runAdministration(database, validated, suspend)
      );
      expect(suspended).toMatchObject({ status: "suspended", version: 2 });
      await expect(
        Effect.runPromise(runAdministration(database, validated, suspend))
      ).resolves.toStrictEqual(suspended);

      const resumed = await Effect.runPromise(
        runAdministration(
          database,
          validated,
          Effect.gen(function* () {
            const administration = yield* OrganizationAdministration;
            return yield* administration.resume(
              Schema.decodeUnknownSync(ResumeOrganizationCommand)({
                expectedVersion: 2,
                operationId: "00000000-0000-4000-8000-000000000011",
                organizationId: "organization-a",
              })
            );
          })
        )
      );
      expect(resumed).toMatchObject({ status: "active", version: 3 });
      expect(
        sqlite
          .prepare(
            `select action, resource_version_before, resource_version_after
               from app_organization_administrative_audit_event
              order by storage_id`
          )
          .all()
          .map((row) => ({ ...row }))
      ).toStrictEqual([
        {
          action: "organization.suspend",
          resource_version_after: 2,
          resource_version_before: 1,
        },
        {
          action: "organization.resume",
          resource_version_after: 3,
          resource_version_before: 2,
        },
      ]);
      expect(
        sqlite
          .prepare(
            `select operation_kind, result_status, result_version
               from app_organization_administration_receipt
              order by operation_id`
          )
          .all()
          .map((row) => ({ ...row }))
      ).toStrictEqual([
        {
          operation_kind: "suspend",
          result_status: "suspended",
          result_version: 2,
        },
        {
          operation_kind: "resume",
          result_status: "active",
          result_version: 3,
        },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it.each(["global-permission", "membership", "step-up"] as const)(
    "denies missing %s authority without partial writes",
    async (failure) => {
      const sqlite = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(sqlite);
        const validated = makeValidatedSession(failure !== "step-up");
        seedAuthority(
          sqlite,
          validated,
          failure === "global-permission" ? "global" : "organization"
        );
        if (failure === "membership") {
          sqlite.exec(`
            update app_organization_member
               set status = 'suspended', suspended_at = 2000,
                   updated_at = 2000, version = 2
          `);
        }
        const exit = await Effect.runPromiseExit(
          runAdministration(
            makeTestD1Database(sqlite),
            validated,
            Effect.gen(function* () {
              const administration = yield* OrganizationAdministration;
              return yield* administration.suspend(
                Schema.decodeUnknownSync(SuspendOrganizationCommand)({
                  expectedVersion: 1,
                  operationId: "00000000-0000-4000-8000-000000000012",
                  organizationId: "organization-a",
                })
              );
            })
          )
        );
        expect(exit._tag).toBe("Failure");
        expect(
          sqlite
            .prepare(
              `select status, version from app_organization
                where id = 'organization-a'`
            )
            .get()
        ).toMatchObject({ status: "active", version: 1 });
        expect(
          sqlite
            .prepare(
              "select count(*) as count from app_organization_administration_receipt"
            )
            .get()
        ).toMatchObject({ count: 0 });
      } finally {
        sqlite.close();
      }
    }
  );
});
