import { DatabaseSync } from "node:sqlite";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { RecoverySafeIdentityD1Layer } from "#/modules/account-security/adapters/d1/RecoverySafeIdentityD1";
import { ExternalRecoveryIdentityAddress } from "#/modules/account-security/domain/ExternalRecoveryIdentity";
import {
  RecoverySafeIdentityPolicy,
  RecoverySafeIdentityRequest,
} from "#/modules/account-security/ports/RecoverySafeIdentityPolicy";
import {
  MailboxBootstrapConfig,
  MailboxBootstrapConfigValue,
} from "#/modules/organization/contracts/MailboxBootstrapConfig";
import {
  ControlPlaneD1Binding,
  ControlPlaneDatabaseLayer,
} from "#/platform/control-plane-d1/ControlPlaneDatabase";
import {
  EmailAddress,
  normalizeEmailAddressDomain,
} from "#/shared/EmailAddress";

import {
  applyControlPlaneMigrations,
  insertFreshCutoverOrganization,
  makeTestD1Database,
} from "../../../../support/d1";

const policyLive = (database: DatabaseSync) => {
  const databaseLive = ControlPlaneDatabaseLayer.pipe(
    Layer.provide(
      Layer.succeed(
        ControlPlaneD1Binding,
        ControlPlaneD1Binding.of({
          database: makeTestD1Database(database) as unknown as D1Database,
        })
      )
    )
  );

  return RecoverySafeIdentityD1Layer.pipe(
    Layer.provide(databaseLive),
    Layer.provide(
      Layer.succeed(
        MailboxBootstrapConfig,
        MailboxBootstrapConfig.of(
          Schema.decodeUnknownSync(MailboxBootstrapConfigValue)({
            initialAddress: "inbox@company.test",
            initialDomain: "company.test",
            ownerEmailAllowlist: ["owner@company.test"],
          })
        )
      )
    )
  );
};

const externalRecoveryPurpose = {
  purpose: "external-recovery",
} as const;

const loginEmailInitiationPurpose = {
  purpose: "login-email-initiation",
} as const;

interface TestPolicyRequest {
  readonly excludeRecoveryIdentityId?: string;
  readonly purpose: "external-recovery" | "login-email-initiation";
  readonly userId?: string;
}

const requireAddress = (
  database: DatabaseSync,
  address: string,
  request: TestPolicyRequest = externalRecoveryPurpose
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const policy = yield* RecoverySafeIdentityPolicy;
      return yield* policy.requireSafeAddress(
        Schema.decodeUnknownSync(RecoverySafeIdentityRequest)({
          ...request,
          address,
        })
      );
    }).pipe(Effect.provide(policyLive(database)))
  );

const rejectAddress = (
  database: DatabaseSync,
  address: string,
  request: TestPolicyRequest = externalRecoveryPurpose
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const policy = yield* RecoverySafeIdentityPolicy;
      return yield* policy
        .requireSafeAddress(
          Schema.decodeUnknownSync(RecoverySafeIdentityRequest)({
            ...request,
            address,
          })
        )
        .pipe(Effect.flip);
    }).pipe(Effect.provide(policyLive(database)))
  );

const insertMailboxAddress = (
  database: DatabaseSync,
  address: string,
  enabled = true
) => {
  insertFreshCutoverOrganization(database, 1000);
  database
    .prepare(
      `insert into app_mailbox
        (id, display_name, status, created_by_user_id, created_at, updated_at)
       values ('primary', 'Inbox', 'active', 'user-a', 1000, 1000)`
    )
    .run();
  database
    .prepare(
      `insert into app_mailbox_address
        (mailbox_id, id, address, normalized_address, is_primary, enabled,
         created_at, updated_at)
        values ('primary', 'primary', 'inbox@company.test',
                'inbox@company.test', 1, 1, 1000, 1000)`
    )
    .run();
  database
    .prepare(
      `insert into app_mailbox_address
        (mailbox_id, id, address, normalized_address, is_primary, enabled,
         created_at, updated_at)
        values ('primary', 'tested-route', ?, ?, 0, ?, 1000, 1000)`
    )
    .run(address, address, enabled ? 1 : 0);
};

const insertLoginIdentity = (database: DatabaseSync, address: string) => {
  database
    .prepare(
      `insert into auth_user (id, created_at, updated_at)
       values ('user-a', 1000, 1000)`
    )
    .run();
  database
    .prepare(
      `insert into auth_user_identity
        (id, user_id, scope_type, scope_id, kind, value, normalized_value,
         verified_at, is_primary_login, created_at, updated_at)
       values ('identity-a', 'user-a', 'global', '', 'email', ?, ?, 1000, 1,
               1000, 1000)`
    )
    .run(address, address);
};

const insertCurrentMailDomain = (
  database: DatabaseSync,
  id: string,
  canonicalDomain: string
) => {
  if (
    (
      database
        .prepare(
          "select count(*) as count from app_organization where id = 'organization-a'"
        )
        .get() as { count: number }
    ).count === 0
  ) {
    database
      .prepare(
        `insert into app_organization (id, created_at, updated_at)
         values ('organization-a', 1000, 1000)`
      )
      .run();
  }
  database
    .prepare(
      `insert into app_mail_domain
        (id, organization_id, canonical_domain, canonicalization_profile_id,
         canonicalization_version, status, created_at, updated_at, version)
       values (?, 'organization-a', ?,
         'mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1',
         1, 'pending_verification', 1000, 1000, 1)`
    )
    .run(id, canonicalDomain);
};

const insertRecoveryChallenge = (
  database: DatabaseSync,
  challengeId: string,
  identityId: string
) =>
  database
    .prepare(
      `insert into auth_verification
        (id, type, subject, secret_hash, created_at, expires_at, metadata)
       values (?, 'external-recovery-identity-verification', ?, 'hash', 1000,
               4000000000000, '{"userId":"user-a"}')`
    )
    .run(challengeId, identityId);

const insertRecoveryIdentity = (database: DatabaseSync, address: string) => {
  const emailAddress = Schema.decodeUnknownSync(EmailAddress)(address);
  insertRecoveryChallenge(database, "challenge-a", "recovery-a");
  database
    .prepare(
      `insert into app_external_recovery_identity
        (id, user_id, address, normalized_address, comparison_key, status,
         challenge_id, challenge_expires_at, enrollment_operation_id,
         created_at, updated_at, version)
        values ('recovery-a', 'user-a', ?, ?, ?, 'pending', 'challenge-a',
                4000000000000,
                '00000000-0000-4000-8000-000000000020', 1000, 1000, 1)`
    )
    .run(
      address,
      normalizeEmailAddressDomain(emailAddress),
      address.toLowerCase()
    );
};

describe("recovery-safe identity policy", () => {
  it("requires canonical address projections", () => {
    expect(() =>
      Schema.decodeUnknownSync(ExternalRecoveryIdentityAddress)({
        address: "Person@External.test",
        comparisonKey: "person@external.test",
        normalizedAddress: "person@external.test",
      })
    ).toThrow(/canonical normalization/u);

    expect(
      Schema.decodeUnknownSync(ExternalRecoveryIdentityAddress)({
        address: "Person@External.test",
        comparisonKey: "person@external.test",
        normalizedAddress: "Person@external.test",
      })
    ).toStrictEqual({
      address: "Person@External.test",
      comparisonKey: "person@external.test",
      normalizedAddress: "Person@external.test",
    });
  });

  it("accepts a unique address outside the managed domain", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      await expect(
        requireAddress(database, "person@external.test")
      ).resolves.toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("uses the expiry index for pending recovery duplicate checks", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const plan = database
        .prepare(
          `explain query plan
           select id from app_external_recovery_identity
             where comparison_key = ?
               and status = 'pending'
               and challenge_expires_at > ?
             limit 1`
        )
        .all("person@external.test", Date.now()) as { detail: string }[];
      expect(
        plan.some((row) =>
          row.detail.includes(
            "app_external_recovery_identity_pending_address_expiry_idx"
          )
        )
      ).toBeTruthy();
    } finally {
      database.close();
    }
  });

  it.each([externalRecoveryPurpose, loginEmailInitiationPurpose] as const)(
    "rejects the managed owner domain for $purpose",
    async (purpose) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        await expect(
          rejectAddress(database, "another@company.test", purpose)
        ).resolves.toMatchObject({ reason: "managed-domain" });
      } finally {
        database.close();
      }
    }
  );

  it("uses an agreeing current persisted domain before bootstrap", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertCurrentMailDomain(database, "domain-a", "company.test");
      await expect(
        rejectAddress(database, "person@company.test")
      ).resolves.toMatchObject({ reason: "managed-domain" });
    } finally {
      database.close();
    }
  });

  it("uses the legacy primary route when persisted domain storage is empty", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertMailboxAddress(database, "person@external.test");
      await expect(
        rejectAddress(database, "other@company.test")
      ).resolves.toMatchObject({ reason: "managed-domain" });
    } finally {
      database.close();
    }
  });

  it.each([
    "multiple-current-domains",
    "persisted-trusted-disagreement",
    "persisted-legacy-disagreement",
    "legacy-trusted-disagreement",
    "malformed-legacy-projection",
    "multiple-legacy-primary",
    "existing-mailbox-without-claim",
    "malformed-persisted-domain",
  ] as const)("fails closed for %s", async (state) => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      if (state === "multiple-current-domains") {
        insertCurrentMailDomain(database, "domain-a", "company.test");
        insertCurrentMailDomain(database, "domain-b", "other.test");
      } else if (state === "persisted-trusted-disagreement") {
        insertCurrentMailDomain(database, "domain-a", "other.test");
      } else if (state === "persisted-legacy-disagreement") {
        insertMailboxAddress(database, "person@external.test");
        insertCurrentMailDomain(database, "domain-a", "other.test");
      } else if (state === "legacy-trusted-disagreement") {
        insertMailboxAddress(database, "person@external.test");
        database
          .prepare(
            `update app_mailbox_address
                set address = 'inbox@other.test',
                    normalized_address = 'inbox@other.test'
              where mailbox_id = 'primary' and id = 'primary'`
          )
          .run();
      } else if (state === "malformed-legacy-projection") {
        insertMailboxAddress(database, "person@external.test");
        database
          .prepare(
            `update app_mailbox_address
                set address = 'Inbox@company.test'
              where mailbox_id = 'primary' and id = 'primary'`
          )
          .run();
      } else if (state === "multiple-legacy-primary") {
        insertMailboxAddress(database, "person@external.test");
        database.exec("drop index app_mailbox_address_primary_idx");
        database
          .prepare(
            `insert into app_mailbox_address
              (mailbox_id, id, address, normalized_address, is_primary,
               enabled, created_at, updated_at)
             values ('primary', 'second-primary', 'second@company.test',
                     'second@company.test', 1, 1, 1000, 1000)`
          )
          .run();
      } else if (state === "existing-mailbox-without-claim") {
        insertFreshCutoverOrganization(database, 1000);
        database
          .prepare(
            `insert into app_mailbox
              (id, display_name, status, created_by_user_id, created_at,
               updated_at)
             values ('primary', 'Inbox', 'active', 'user-a', 1000, 1000)`
          )
          .run();
      } else {
        database.exec("pragma ignore_check_constraints = on");
        insertCurrentMailDomain(database, "domain-a", "Company.test");
        database.exec("pragma ignore_check_constraints = off");
      }

      await expect(
        rejectAddress(database, "person@external.test")
      ).resolves.toMatchObject({ reason: "storage" });
    } finally {
      database.close();
    }
  });

  it.each([externalRecoveryPurpose, loginEmailInitiationPurpose] as const)(
    "rejects a mailbox route for $purpose",
    async (purpose) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        insertMailboxAddress(database, "Person@External.test");
        await expect(
          rejectAddress(database, "person@external.test", purpose)
        ).resolves.toMatchObject({ reason: "mailbox-address" });
      } finally {
        database.close();
      }
    }
  );

  it("rejects a disabled mailbox route for login initiation", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertMailboxAddress(database, "Person@External.test", false);
      await expect(
        rejectAddress(
          database,
          "person@external.test",
          loginEmailInitiationPurpose
        )
      ).resolves.toMatchObject({ reason: "mailbox-address" });
    } finally {
      database.close();
    }
  });

  it.each([
    ["mailbox route", insertMailboxAddress, "mailbox-address"],
    ["login identity", insertLoginIdentity, "login-identity"],
    ["recovery identity", insertRecoveryIdentity, "recovery-identity"],
  ] as const)("rejects an existing %s", async (_, insert, reason) => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insert(database, "Person@External.test");
      const error = await rejectAddress(database, "person@external.test");
      expect(error).toMatchObject({ reason });
    } finally {
      database.close();
    }
  });

  it("allows login initiation for a matching active login identity", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertLoginIdentity(database, "Person@External.test");
      await expect(
        requireAddress(
          database,
          "person@external.test",
          loginEmailInitiationPurpose
        )
      ).resolves.toBeUndefined();
      await expect(
        rejectAddress(database, "person@external.test")
      ).resolves.toMatchObject({ reason: "login-identity" });
    } finally {
      database.close();
    }
  });

  it("allows login initiation when no login identity exists", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      await expect(
        requireAddress(
          database,
          "unknown@external.test",
          loginEmailInitiationPurpose
        )
      ).resolves.toBeUndefined();
    } finally {
      database.close();
    }
  });

  it.each(["pending", "verified"] as const)(
    "rejects a %s recovery identity for login initiation",
    async (status) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        insertRecoveryIdentity(database, "Person@External.test");
        if (status === "verified") {
          database.exec(`update auth_verification
            set consumed_at = 1500 where id = 'challenge-a';
            update app_external_recovery_identity
              set status = 'verified', verified_at = 1500, updated_at = 1500,
                  version = 2
              where id = 'recovery-a'`);
        }

        await expect(
          rejectAddress(
            database,
            "person@external.test",
            loginEmailInitiationPurpose
          )
        ).resolves.toMatchObject({ reason: "recovery-identity" });
      } finally {
        database.close();
      }
    }
  );

  it.each(["expired", "revoked"] as const)(
    "allows login initiation after a recovery identity is %s",
    async (state) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        if (state === "expired") {
          database.exec(`insert into auth_verification
            (id, type, subject, secret_hash, created_at, expires_at, metadata)
            values ('challenge-a', 'external-recovery-identity-verification',
                    'recovery-a', 'hash', 1000, 2000,
                    '{"userId":"user-a"}');
            insert into app_external_recovery_identity
            (id, user_id, address, normalized_address, comparison_key, status,
             challenge_id, challenge_expires_at, enrollment_operation_id,
             created_at, updated_at, version)
            values ('recovery-a', 'user-a', 'person@external.test',
                    'person@external.test', 'person@external.test', 'pending',
                    'challenge-a', 2000,
                    '00000000-0000-4000-8000-000000000020', 1000, 1000, 1)`);
        } else {
          insertRecoveryIdentity(database, "person@external.test");
          database.exec(`update app_external_recovery_identity
            set status = 'revoked', revoked_at = 1500, updated_at = 1500,
                version = 2
            where id = 'recovery-a'`);
        }

        await expect(
          requireAddress(
            database,
            "PERSON@EXTERNAL.TEST",
            loginEmailInitiationPurpose
          )
        ).resolves.toBeUndefined();
      } finally {
        database.close();
      }
    }
  );

  it("rejects another active recovery identity owned by the enrolling user", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertRecoveryIdentity(database, "first@external.test");
      await expect(
        rejectAddress(database, "second@external.test", {
          purpose: "external-recovery",
          userId: "user-a",
        })
      ).resolves.toMatchObject({ reason: "recovery-identity" });
    } finally {
      database.close();
    }
  });

  it("excludes only the exact recovery identity", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertRecoveryIdentity(database, "person@external.test");
      await expect(
        requireAddress(database, "PERSON@EXTERNAL.TEST", {
          excludeRecoveryIdentityId: "recovery-a",
          purpose: "external-recovery",
        })
      ).resolves.toBeUndefined();
      await expect(
        rejectAddress(database, "person@external.test", {
          excludeRecoveryIdentityId: "recovery-other",
          purpose: "external-recovery",
        })
      ).resolves.toMatchObject({ reason: "recovery-identity" });
    } finally {
      database.close();
    }
  });

  it.each([externalRecoveryPurpose, loginEmailInitiationPurpose] as const)(
    "fails closed on storage errors for $purpose",
    async (purpose) => {
      const database = new DatabaseSync(":memory:");
      await applyControlPlaneMigrations(database);
      database.close();

      await expect(
        rejectAddress(database, "person@external.test", purpose)
      ).resolves.toMatchObject({ reason: "storage" });
    }
  );

  it("enforces one pending candidate per user", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertRecoveryIdentity(database, "first@external.test");
      insertRecoveryChallenge(database, "challenge-b", "recovery-b");
      expect(() =>
        database
          .prepare(
            `insert into app_external_recovery_identity
              (id, user_id, address, normalized_address, comparison_key,
               status, challenge_id, challenge_expires_at,
               enrollment_operation_id, created_at, updated_at, version)
             values ('recovery-b', 'user-a', 'second@external.test',
                     'second@external.test', 'second@external.test', 'pending',
                      'challenge-b', 4000000000000,
                      '00000000-0000-4000-8000-000000000021', 1000, 1000, 1)`
          )
          .run()
      ).toThrow(/conflicts with active identity/u);
    } finally {
      database.close();
    }
  });

  it("releases an unverified pending reservation after challenge expiry", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      database.exec(`insert into auth_verification
        (id, type, subject, secret_hash, created_at, expires_at, metadata)
        values ('expired-challenge',
                'external-recovery-identity-verification', 'expired-recovery',
                'hash', 1000, 2000, '{"userId":"user-a"}');
        insert into app_external_recovery_identity
        (id, user_id, address, normalized_address, comparison_key, status,
         challenge_id, challenge_expires_at, enrollment_operation_id,
         created_at, updated_at, version)
        values ('expired-recovery', 'user-a', 'person@external.test',
                'person@external.test', 'person@external.test', 'pending',
                'expired-challenge', 2000,
                '00000000-0000-4000-8000-000000000022', 1000, 1000, 1)`);

      await expect(
        requireAddress(database, "person@external.test")
      ).resolves.toBeUndefined();
      expect(() =>
        insertMailboxAddress(database, "person@external.test")
      ).not.toThrow();
    } finally {
      database.close();
    }
  });

  it("cannot insert a fabricated verified recovery identity", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertRecoveryChallenge(database, "challenge-a", "recovery-a");

      expect(() =>
        database.exec(`insert into app_external_recovery_identity
          (id, user_id, address, normalized_address, comparison_key, status,
           challenge_id, challenge_expires_at, enrollment_operation_id,
           created_at, updated_at, verified_at, version)
          values ('recovery-a', 'user-a', 'person@external.test',
                  'person@external.test', 'person@external.test', 'verified',
                  'challenge-a', 4000000000000,
                  '00000000-0000-4000-8000-000000000020', 1000, 1500, 1500,
                  2)`)
      ).toThrow(/must start pending/u);
    } finally {
      database.close();
    }
  });

  it("cannot verify with challenge consumption after expiry", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      database.exec(`insert into auth_verification
        (id, type, subject, secret_hash, created_at, expires_at, metadata)
        values ('challenge-a', 'external-recovery-identity-verification',
                'recovery-a', 'hash', 1000, 2000,
                '{"userId":"user-a"}');
        insert into app_external_recovery_identity
        (id, user_id, address, normalized_address, comparison_key, status,
         challenge_id, challenge_expires_at, enrollment_operation_id,
         created_at, updated_at, version)
        values ('recovery-a', 'user-a', 'person@external.test',
                'person@external.test', 'person@external.test', 'pending',
                'challenge-a', 2000,
                '00000000-0000-4000-8000-000000000020', 1000, 1000, 1);
        update auth_verification set consumed_at = 2500
         where id = 'challenge-a'`);

      expect(() =>
        database.exec(`update app_external_recovery_identity
          set status = 'verified', verified_at = 2500, updated_at = 2500,
              version = 2
          where id = 'recovery-a'`)
      ).toThrow(/not consumed atomically/u);
    } finally {
      database.close();
    }
  });

  it.each([
    ["mailbox route", insertMailboxAddress],
    ["login identity", insertLoginIdentity],
  ] as const)(
    "atomically rejects recovery identity after a %s",
    async (_, insert) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        insert(database, "Person@External.test");
        expect(() =>
          insertRecoveryIdentity(database, "person@external.test")
        ).toThrow(/conflicts/u);
      } finally {
        database.close();
      }
    }
  );

  it.each([
    ["mailbox route", insertMailboxAddress],
    ["login identity", insertLoginIdentity],
  ] as const)(
    "atomically rejects a %s after recovery identity",
    async (_, insert) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        insertRecoveryIdentity(database, "Person@External.test");
        expect(() => insert(database, "person@external.test")).toThrow(
          /conflicts/u
        );
      } finally {
        database.close();
      }
    }
  );

  it("binds stored projections to the recovery address", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertRecoveryChallenge(database, "challenge-a", "recovery-a");
      insertRecoveryChallenge(database, "challenge-b", "recovery-b");
      expect(() =>
        database
          .prepare(
            `insert into app_external_recovery_identity
              (id, user_id, address, normalized_address, comparison_key,
               status, challenge_id, challenge_expires_at,
               enrollment_operation_id, created_at, updated_at, version)
             values ('recovery-a', 'user-a', 'first@external.test',
                     'first@external.test', 'different@external.test',
                      'pending', 'challenge-a', 4000000000000,
                      '00000000-0000-4000-8000-000000000020', 1000, 1000, 1)`
          )
          .run()
      ).toThrow(/CHECK constraint failed/u);
      expect(() =>
        database
          .prepare(
            `insert into app_external_recovery_identity
              (id, user_id, address, normalized_address, comparison_key,
               status, challenge_id, challenge_expires_at,
               enrollment_operation_id, created_at, updated_at, version)
             values ('recovery-b', 'user-a', 'Person@External.test',
                     'other@external.test', 'person@external.test', 'pending',
                      'challenge-b', 4000000000000,
                      '00000000-0000-4000-8000-000000000021', 1000, 1000, 1)`
          )
          .run()
      ).toThrow(/CHECK constraint failed/u);
    } finally {
      database.close();
    }
  });

  it("releases the address reservation only after revocation", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertRecoveryIdentity(database, "person@external.test");
      database
        .prepare(
          "update auth_verification set consumed_at = 1500 where id = 'challenge-a'"
        )
        .run();
      database
        .prepare(
          `update app_external_recovery_identity
              set status = 'verified', verified_at = 1500, updated_at = 1500,
                  version = version + 1
            where id = 'recovery-a'`
        )
        .run();
      expect(() =>
        insertMailboxAddress(database, "person@external.test")
      ).toThrow(/conflicts/u);

      database
        .prepare(
          `update app_external_recovery_identity
              set status = 'revoked', revoked_at = 1600, updated_at = 1600,
                  version = version + 1
            where id = 'recovery-a'`
        )
        .run();
      expect(() =>
        database
          .prepare(
            `update app_external_recovery_identity
                set status = 'verified', updated_at = 1700,
                    version = version + 1
              where id = 'recovery-a'`
          )
          .run()
      ).toThrow(/invalid external recovery identity state transition/u);
      expect(() =>
        database
          .prepare(
            `update app_external_recovery_identity
                set verified_at = 1550
              where id = 'recovery-a'`
          )
          .run()
      ).toThrow(/verification time is immutable/u);
      expect(() =>
        database
          .prepare(
            `update app_external_recovery_identity
                set revoked_at = 1650, updated_at = 1650
              where id = 'recovery-a'`
          )
          .run()
      ).toThrow(/revocation time is immutable/u);
      expect(() =>
        database
          .prepare(
            `insert into app_mailbox_address
              (mailbox_id, id, address, normalized_address, is_primary,
               enabled, created_at, updated_at)
             values ('primary', 'released-route', 'person@external.test',
                     'person@external.test', 0, 1, 1000, 1000)`
          )
          .run()
      ).not.toThrow();
    } finally {
      database.close();
    }
  });

  it("cannot invent verification while revoking a pending identity", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertRecoveryIdentity(database, "person@external.test");
      expect(() =>
        database
          .prepare(
            `update app_external_recovery_identity
                set status = 'revoked', verified_at = 1400,
                    revoked_at = 1500, updated_at = 1500,
                    version = version + 1
              where id = 'recovery-a'`
          )
          .run()
      ).toThrow(/verification time is immutable/u);
    } finally {
      database.close();
    }
  });

  it.each([
    ["mailbox route", insertMailboxAddress],
    ["login identity", insertLoginIdentity],
  ] as const)(
    "rejects recovery-address updates into an existing %s",
    async (_, insert) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        insertRecoveryIdentity(database, "first@external.test");
        insert(database, "second@external.test");
        expect(() =>
          database
            .prepare(
              `update app_external_recovery_identity
                  set address = 'second@external.test',
                      normalized_address = 'second@external.test',
                      comparison_key = 'second@external.test'
                where id = 'recovery-a'`
            )
            .run()
        ).toThrow(/core fields are immutable/u);
      } finally {
        database.close();
      }
    }
  );

  it("rejects conflicting mailbox-address updates", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertRecoveryIdentity(database, "person@external.test");
      insertMailboxAddress(database, "other@external.test");
      expect(() =>
        database
          .prepare(
            `update app_mailbox_address
                set normalized_address = 'person@external.test'
              where id = 'primary'`
          )
          .run()
      ).toThrow(/conflicts/u);
    } finally {
      database.close();
    }
  });

  it("rejects conflicting login-identity updates", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertRecoveryIdentity(database, "person@external.test");
      insertLoginIdentity(database, "other@external.test");
      expect(() =>
        database
          .prepare(
            `update auth_user_identity
                set normalized_value = 'person@external.test'
              where id = 'identity-a'`
          )
          .run()
      ).toThrow(/conflicts/u);
      database
        .prepare(
          `update auth_user_identity
              set kind = 'username',
                  normalized_value = 'person@external.test'
            where id = 'identity-a'`
        )
        .run();
      expect(() =>
        database
          .prepare(
            `update auth_user_identity
                set kind = 'email'
              where id = 'identity-a'`
          )
          .run()
      ).toThrow(/conflicts/u);
      database
        .prepare(
          `update auth_user_identity
              set kind = 'email', revoked_at = 1200
            where id = 'identity-a'`
        )
        .run();
      expect(() =>
        database
          .prepare(
            `update auth_user_identity
                set revoked_at = null
              where id = 'identity-a'`
          )
          .run()
      ).toThrow(/conflicts/u);
    } finally {
      database.close();
    }
  });
});

const challengeBindings = [
  ["email-otp", "emailNormalizedValue"],
  ["magic-link", "emailNormalizedValue"],
  ["reset-password", "normalizedValue"],
  ["email-verification", "expectedNormalizedValue"],
] as const;

const futureChallengeExpiry = 4_000_000_000_000;

const insertInterlockMailbox = (database: DatabaseSync) => {
  insertFreshCutoverOrganization(database, 1000);
  database.exec(`insert into app_mailbox
    (id, display_name, status, created_by_user_id, created_at, updated_at)
    values ('primary', 'Inbox', 'active', 'user-a', 1000, 1000)`);
};

const insertInterlockRoute = (
  database: DatabaseSync,
  address: string,
  id = "route-a"
) =>
  database
    .prepare(
      `insert into app_mailbox_address
        (mailbox_id, id, address, normalized_address, is_primary, enabled,
         created_at, updated_at)
        values ('primary', ?, ?, ?, 1, 1, 1000, 1000)`
    )
    .run(id, address, address);

const insertEmailChallenge = (
  database: DatabaseSync,
  type: string,
  bindingKey: string,
  address: string,
  expiresAt = futureChallengeExpiry,
  challengeId = "challenge-a"
) =>
  database
    .prepare(
      `insert into auth_verification
        (id, type, subject, secret_hash, created_at, expires_at, metadata)
       values (?, ?, 'identity-a', 'hash', 1000, ?, ?)`
    )
    .run(
      challengeId,
      type,
      expiresAt,
      JSON.stringify({ [bindingKey]: address })
    );

describe("recovery-safe email initiation temporal interlock", () => {
  it.each(challengeBindings)(
    "rejects %s challenge insertion after a mailbox route",
    async (type, bindingKey) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        insertInterlockMailbox(database);
        insertInterlockRoute(database, "Person@External.test");

        expect(() =>
          insertEmailChallenge(
            database,
            type,
            bindingKey,
            "person@external.TEST"
          )
        ).toThrow(/conflicts with mailbox route/u);
      } finally {
        database.close();
      }
    }
  );

  it.each(challengeBindings)(
    "allows a route after an unconsumed %s challenge and rejects later consumption",
    async (type, bindingKey) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        insertInterlockMailbox(database);
        insertEmailChallenge(
          database,
          type,
          bindingKey,
          "Person@External.test"
        );

        expect(() =>
          insertInterlockRoute(database, "person@external.TEST")
        ).not.toThrow();
        expect(() =>
          database.exec(`update auth_verification
            set consumed_at = 1500 where id = 'challenge-a'`)
        ).toThrow(/conflicts with mailbox route/u);
      } finally {
        database.close();
      }
    }
  );

  it("allows repeated unconsumed challenge renewal without reserving a route", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertInterlockMailbox(database);
      for (const challengeId of ["challenge-a", "challenge-b", "challenge-c"]) {
        insertEmailChallenge(
          database,
          "email-otp",
          "emailNormalizedValue",
          "person@external.test",
          futureChallengeExpiry,
          challengeId
        );
      }

      expect(() =>
        insertInterlockRoute(database, "person@external.test")
      ).not.toThrow();
      expect(() =>
        database.exec(`update auth_verification
          set consumed_at = 1500 where id = 'challenge-c'`)
      ).toThrow(/conflicts with mailbox route/u);
    } finally {
      database.close();
    }
  });

  it("keeps a consumed challenge reserved until expiry", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertInterlockMailbox(database);
      insertEmailChallenge(
        database,
        "magic-link",
        "emailNormalizedValue",
        "person@external.test"
      );
      database.exec(`update auth_verification
        set consumed_at = 1500 where id = 'challenge-a'`);

      expect(() =>
        insertInterlockRoute(database, "person@external.test")
      ).toThrow(/conflicts with active email challenge/u);
    } finally {
      database.close();
    }
  });

  it("releases the route after challenge expiry", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertInterlockMailbox(database);
      insertEmailChallenge(
        database,
        "reset-password",
        "normalizedValue",
        "person@external.test",
        2000
      );
      database.exec(`update auth_verification
        set consumed_at = 1500 where id = 'challenge-a'`);

      expect(() =>
        insertInterlockRoute(database, "person@external.test")
      ).not.toThrow();
    } finally {
      database.close();
    }
  });

  it.each(challengeBindings)(
    "rejects a missing binding for %s",
    async (type) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        expect(() =>
          database
            .prepare(
              `insert into auth_verification
                (id, type, subject, secret_hash, created_at, expires_at,
                 metadata)
               values ('challenge-a', ?, 'identity-a', 'hash', 1000, ?, '{}')`
            )
            .run(type, futureChallengeExpiry)
        ).toThrow(/invalid binding/u);
      } finally {
        database.close();
      }
    }
  );

  it.each([null, "{", '{"emailNormalizedValue":42}'])(
    "rejects malformed email challenge metadata %#",
    async (metadata) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        expect(() =>
          database
            .prepare(
              `insert into auth_verification
                (id, type, subject, secret_hash, created_at, expires_at,
                 metadata)
               values ('challenge-a', 'email-otp', 'identity-a', 'hash',
                       1000, ?, ?)`
            )
            .run(futureChallengeExpiry, metadata)
        ).toThrow(/invalid binding/u);
      } finally {
        database.close();
      }
    }
  );

  it("does not let malformed unconsumed history block unrelated routes", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertInterlockMailbox(database);
      database.exec(`drop trigger auth_verification_recovery_safe_email_insert;
        insert into auth_verification
          (id, type, subject, secret_hash, created_at, expires_at, metadata)
        values ('challenge-a', 'magic-link', 'identity-a', 'hash', 1000,
                4000000000000, '{')`);

      expect(() =>
        insertInterlockRoute(database, "unrelated@external.test")
      ).not.toThrow();
    } finally {
      database.close();
    }
  });

  it("fails closed for a pre-existing malformed consumed challenge", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertInterlockMailbox(database);
      database.exec(`drop trigger auth_verification_recovery_safe_email_insert;
        insert into auth_verification
          (id, type, subject, secret_hash, created_at, expires_at, consumed_at,
           metadata)
        values ('challenge-a', 'magic-link', 'identity-a', 'hash', 1000,
                4000000000000, 1500, '{')`);

      expect(() =>
        insertInterlockRoute(database, "unrelated@external.test")
      ).toThrow(/conflicts with active email challenge/u);
    } finally {
      database.close();
    }
  });

  it.each([
    ["type", "type = 'magic-link'"],
    ["subject", "subject = 'identity-b'"],
    ["secret hash", "secret_hash = 'different'"],
    ["expiry", "expires_at = 4000000000001"],
    ["metadata", `metadata = '{"emailNormalizedValue":"other@external.test"}'`],
  ])("keeps challenge %s immutable", async (_, assignment) => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertEmailChallenge(
        database,
        "email-otp",
        "emailNormalizedValue",
        "person@external.test"
      );
      database.exec(`update auth_verification
        set consumed_at = 1500 where id = 'challenge-a'`);

      expect(() =>
        database.exec(`update auth_verification set ${assignment}
          where id = 'challenge-a'`)
      ).toThrow(/binding is immutable/u);
    } finally {
      database.close();
    }
  });

  it("rejects a conflicting mailbox route update", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertInterlockMailbox(database);
      insertInterlockRoute(database, "other@external.test");
      insertEmailChallenge(
        database,
        "email-verification",
        "expectedNormalizedValue",
        "person@external.test"
      );
      database.exec(`update auth_verification
        set consumed_at = 1500 where id = 'challenge-a'`);

      expect(() =>
        database.exec(`update app_mailbox_address
          set normalized_address = 'PERSON@EXTERNAL.TEST'
          where id = 'route-a'`)
      ).toThrow(/conflicts with active email challenge/u);
    } finally {
      database.close();
    }
  });

  it("does not constrain custom auth flow state challenges", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertInterlockMailbox(database);
      insertInterlockRoute(database, "person@external.test");

      expect(() =>
        database.exec(`insert into auth_verification
          (id, type, subject, secret_hash, created_at, expires_at, metadata)
          values ('flow-a', 'auth-flow-state', 'user-a', 'hash', 1000,
                  4000000000000, '{');
          update auth_verification
             set type = 'custom-auth-flow-state', expires_at = 4000000000001,
                 metadata = null
           where id = 'flow-a'`)
      ).not.toThrow();
    } finally {
      database.close();
    }
  });
});
