import { DatabaseSync } from "node:sqlite";

import {
  SessionId,
  SessionToken,
  UnixMillis as AuthUnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import * as AuthPermission from "@effect-auth/core/Permission";
import type { ValidatedSession } from "@effect-auth/core/Sessions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { CurrentRequestAuth } from "#/modules/account-security/ports/CurrentRequestAuth";
import {
  AdministrativeAudit,
  AdministrativeAuditEventSchema,
} from "#/modules/administrative-audit/application/AdministrativeAudit";
import {
  AdministrativeAuditLayer,
  AdministrativeAuditRuntimeLayer,
} from "#/modules/administrative-audit/layers/AdministrativeAuditLayer";
import { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import {
  BackendRequestContext,
  CurrentBackendRequestContext,
} from "#/observability/request-context";
import { AdministrativeOperationId } from "#/shared/Operation";
import { UnixMillis } from "#/shared/Temporal";

import { applyControlPlaneMigrations } from "../../../support/d1";

const userId = UserId("user-a");
const sessionId = SessionId("session-a");
const validated: ValidatedSession = {
  actor: { sessionId, userId },
  currentSession: {
    aal: "aal1",
    amr: ["pwd"],
    authenticationEvents: [],
    authTime: AuthUnixMillis(1000),
    expiresAt: AuthUnixMillis(10_000),
    sessionId,
    userId,
  },
  issued: {
    aal: "aal1",
    amr: ["pwd"],
    authenticationEvents: [],
    authTime: AuthUnixMillis(1000),
    expiresAt: AuthUnixMillis(10_000),
    sessionId,
    token: SessionToken("session-a.secret"),
    userId,
  },
};
const requestContext = Schema.decodeUnknownSync(BackendRequestContext)({
  correlationId: "00000000-0000-4000-8000-000000000002",
  requestId: "00000000-0000-4000-8000-000000000001",
});

const prepareBootstrap = (principalId = "user-a") =>
  Effect.gen(function* () {
    const audit = yield* AdministrativeAudit;
    return yield* audit.prepare({
      _tag: "MailboxBootstrapped",
      mailboxId: Schema.decodeUnknownSync(MailboxId)("primary"),
      occurredAt: Schema.decodeUnknownSync(UnixMillis)(2000),
      operationId: Schema.decodeUnknownSync(AdministrativeOperationId)(
        "00000000-0000-4000-8000-000000000010"
      ),
    });
  }).pipe(
    Effect.provide(
      AdministrativeAuditLayer.pipe(
        Layer.provide(AdministrativeAuditRuntimeLayer)
      )
    ),
    Effect.provideService(
      CurrentRequestAuth,
      CurrentRequestAuth.of({ sessionSecretHash: "hash", validated })
    ),
    Effect.provideService(
      AuthPermission.CurrentPrincipal,
      AuthPermission.CurrentPrincipal.of(
        AuthPermission.PermissionSubject.user(UserId(principalId))
      )
    ),
    Effect.provideService(CurrentBackendRequestContext, requestContext)
  );

describe("administrative audit contract", () => {
  it("prepares deterministic privacy-bounded metadata from trusted contexts", async () => {
    const first = await Effect.runPromise(prepareBootstrap());
    const second = await Effect.runPromise(prepareBootstrap());
    const encoded = Schema.encodeSync(AdministrativeAuditEventSchema)(first);

    expect(first.eventId).toBe(second.eventId);
    expect(encoded).toStrictEqual({
      action: "mailbox.owner-bootstrap",
      actor: { id: "user-a", type: "user" },
      change: { _tag: "MailboxBootstrapped", afterVersion: 1 },
      eventId: first.eventId,
      eventVersion: 1,
      occurredAt: 2000,
      operationId: "00000000-0000-4000-8000-000000000010",
      outcome: "succeeded",
      reasonCode: "owner-bootstrap",
      requestContext: {
        correlationId: "00000000-0000-4000-8000-000000000002",
        requestId: "00000000-0000-4000-8000-000000000001",
      },
      resource: { _tag: "Mailbox", id: "primary" },
      schemaVersion: 1,
      tenantScope: { _tag: "LegacyMailbox", mailboxId: "primary" },
    });
    expect(JSON.stringify(encoded)).not.toMatch(
      /address|body|cookie|displayName|ip|mime|secret|session|storageKey|subject|token/u
    );
  });

  it("rejects inconsistent actor contexts", async () => {
    await expect(
      Effect.runPromise(prepareBootstrap("user-b"))
    ).rejects.toMatchObject({ reason: "invalid-context" });
  });
});

describe("administrative audit storage", () => {
  it("exposes only the reviewed metadata columns and is append-only", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const columns = database
        .prepare("pragma table_info(app_administrative_audit_event)")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(columns).toStrictEqual([
        "storage_id",
        "event_id",
        "schema_version",
        "event_version",
        "operation_id",
        "action",
        "outcome",
        "actor_type",
        "actor_id",
        "tenant_scope_type",
        "tenant_scope_id",
        "resource_type",
        "resource_id",
        "request_id",
        "correlation_id",
        "reason_code",
        "change_type",
        "resource_version_before",
        "resource_version_after",
        "occurred_at",
      ]);

      database
        .prepare(
          `insert into app_administrative_audit_event
            (event_id, schema_version, event_version, operation_id, action,
             outcome, actor_type, actor_id, tenant_scope_type, tenant_scope_id,
             resource_type, resource_id, request_id, correlation_id,
             reason_code, change_type, resource_version_before,
             resource_version_after, occurred_at)
           values (?, 1, 1, '00000000-0000-4000-8000-000000000010',
                   'mailbox.owner-bootstrap',
                   'succeeded', 'user', 'user-a', 'legacy-mailbox', 'primary',
                   'mailbox', 'primary', ?, ?, 'owner-bootstrap',
                   'mailbox-bootstrapped', null, 1, 2000)`
        )
        .run(
          `admin-audit-sha256:${"a".repeat(64)}`,
          requestContext.requestId,
          requestContext.correlationId
        );

      expect(() =>
        database.exec(
          "update app_administrative_audit_event set occurred_at = 3000"
        )
      ).toThrow(/append-only/u);
      expect(() =>
        database.exec("delete from app_administrative_audit_event")
      ).toThrow(/retained/u);
      expect(() =>
        database.exec(`pragma recursive_triggers = off;
          insert or replace into app_administrative_audit_event
          select * from app_administrative_audit_event`)
      ).toThrow(/append-only/u);
      expect(() =>
        database.exec(`insert or replace into app_administrative_audit_event
          select storage_id, 'admin-audit-sha256:${"b".repeat(64)}',
                 schema_version, event_version, operation_id, action, outcome,
                 actor_type, actor_id, tenant_scope_type, tenant_scope_id,
                 resource_type, resource_id, request_id, correlation_id,
                 reason_code, change_type, resource_version_before,
                 resource_version_after, occurred_at
            from app_administrative_audit_event`)
      ).toThrow(/append-only/u);
    } finally {
      database.close();
    }
  });

  it("enforces the opaque operation ID contract in D1", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);

      expect(() =>
        database
          .prepare(
            `insert into app_administrative_audit_event
              (event_id, schema_version, event_version, operation_id, action,
               outcome, actor_type, actor_id, tenant_scope_type,
               tenant_scope_id, resource_type, resource_id, reason_code,
               change_type, resource_version_after, occurred_at)
             values (?, 1, 1, ?, 'mailbox.owner-bootstrap', 'succeeded',
                     'user', 'user-a', 'legacy-mailbox', 'primary', 'mailbox',
                     'primary', 'owner-bootstrap', 'mailbox-bootstrapped', 1,
                     2000)`
          )
          .run(
            `admin-audit-sha256:${"c".repeat(64)}`,
            "00000000-0000-4000-8000-00000000001-"
          )
      ).toThrow(/constraint/u);
    } finally {
      database.close();
    }
  });
});
