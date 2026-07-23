import { DatabaseSync } from "node:sqlite";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  ExternalRecoveryIdentityAddress,
  RecoverySafeIdentityPolicy,
} from "#/auth/external-recovery-identity";
import { RecoverySafeIdentityPolicyLive } from "#/control-plane/recovery-safe-identity-live";
import {
  EmailAddress,
  normalizeEmailAddressDomain,
} from "#/modules/address-routing/domain/EmailAddress";
import {
  MailboxAdministrationConfig,
  MailboxAdministrationOwnerEmail,
} from "#/modules/organization/adapters/d1/MailboxAdministrationD1";
import {
  ControlPlaneD1Binding,
  ControlPlaneDatabaseLayer,
} from "#/platform/control-plane-d1/ControlPlaneDatabase";

import { applyControlPlaneMigrations, makeTestD1Database } from "../support/d1";

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

  return RecoverySafeIdentityPolicyLive.pipe(
    Layer.provide(databaseLive),
    Layer.provide(
      Layer.succeed(
        MailboxAdministrationConfig,
        MailboxAdministrationConfig.of({
          ownerEmail: Schema.decodeUnknownSync(MailboxAdministrationOwnerEmail)(
            "owner@company.test"
          ),
        })
      )
    )
  );
};

const requireAddress = (database: DatabaseSync, address: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const policy = yield* RecoverySafeIdentityPolicy;
      return yield* policy.requireExternalRecoveryAddress({
        address: Schema.decodeUnknownSync(EmailAddress)(address),
      });
    }).pipe(Effect.provide(policyLive(database)))
  );

const rejectAddress = (database: DatabaseSync, address: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const policy = yield* RecoverySafeIdentityPolicy;
      return yield* policy
        .requireExternalRecoveryAddress({
          address: Schema.decodeUnknownSync(EmailAddress)(address),
        })
        .pipe(Effect.flip);
    }).pipe(Effect.provide(policyLive(database)))
  );

const insertMailboxAddress = (database: DatabaseSync, address: string) => {
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
       values ('primary', 'primary', ?, ?, 1, 1, 1000, 1000)`
    )
    .run(address, address);
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

  it("rejects every address in the managed owner domain", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      await expect(
        rejectAddress(database, "another@company.test")
      ).resolves.toMatchObject({ reason: "managed-domain" });
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
             values ('primary', 'primary', 'person@external.test',
                     'person@external.test', 1, 1, 1000, 1000)`
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
