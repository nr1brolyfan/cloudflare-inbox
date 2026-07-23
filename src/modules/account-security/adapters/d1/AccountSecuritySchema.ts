import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const appExternalRecoveryIdentity = sqliteTable(
  "app_external_recovery_identity",
  {
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    address: text("address").notNull(),
    normalizedAddress: text("normalized_address").notNull(),
    comparisonKey: text("comparison_key").notNull(),
    status: text("status", {
      enum: ["pending", "verified", "revoked"],
    }).notNull(),
    challengeId: text("challenge_id").notNull(),
    challengeExpiresAt: integer("challenge_expires_at").notNull(),
    enrollmentOperationId: text("enrollment_operation_id").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    verifiedAt: integer("verified_at"),
    revokedAt: integer("revoked_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    primaryKey({
      name: "app_external_recovery_identity_pkey",
      columns: [t.id],
    }),
    check(
      "app_external_recovery_identity_id_check",
      sql`length(id) between 1 and 128`
    ),
    check(
      "app_external_recovery_identity_user_id_check",
      sql`length(user_id) between 1 and 128`
    ),
    check(
      "app_external_recovery_identity_address_check",
      sql`length(address) between 3 and 320 and address = trim(address)`
    ),
    check(
      "app_external_recovery_identity_normalized_address_check",
      sql`length(normalized_address) between 3 and 320
        and normalized_address = trim(normalized_address)
        and instr(address, '@') > 1
        and instr(substr(address, instr(address, '@') + 1), '@') = 0
        and normalized_address =
          substr(address, 1, instr(address, '@'))
          || lower(substr(address, instr(address, '@') + 1))`
    ),
    check(
      "app_external_recovery_identity_comparison_key_check",
      sql`length(comparison_key) between 3 and 320
        and comparison_key = lower(trim(comparison_key))
        and comparison_key = lower(address)`
    ),
    check(
      "app_external_recovery_identity_status_check",
      sql`status in ('pending', 'verified', 'revoked')`
    ),
    check(
      "app_external_recovery_identity_challenge_id_check",
      sql`length(challenge_id) between 1 and 128`
    ),
    check(
      "app_external_recovery_identity_challenge_expiry_check",
      sql`challenge_expires_at >= 0 and challenge_expires_at > created_at`
    ),
    check(
      "app_external_recovery_identity_operation_id_check",
      sql`length(enrollment_operation_id) = 36
        and enrollment_operation_id = lower(trim(enrollment_operation_id))
        and substr(enrollment_operation_id, 9, 1) = '-'
        and substr(enrollment_operation_id, 14, 1) = '-'
        and substr(enrollment_operation_id, 15, 1) = '4'
        and substr(enrollment_operation_id, 19, 1) = '-'
        and substr(enrollment_operation_id, 20, 1) in ('8', '9', 'a', 'b')
        and substr(enrollment_operation_id, 24, 1) = '-'
        and length(replace(enrollment_operation_id, '-', '')) = 32
        and replace(enrollment_operation_id, '-', '') not glob '*[^0-9a-f]*'`
    ),
    check(
      "app_external_recovery_identity_created_at_check",
      sql`created_at >= 0`
    ),
    check(
      "app_external_recovery_identity_updated_at_check",
      sql`updated_at >= created_at`
    ),
    check(
      "app_external_recovery_identity_verified_at_check",
      sql`verified_at is null
        or (verified_at >= created_at and verified_at <= updated_at)`
    ),
    check(
      "app_external_recovery_identity_revoked_at_check",
      sql`revoked_at is null
        or (revoked_at >= created_at and revoked_at <= updated_at)`
    ),
    check(
      "app_external_recovery_identity_lifecycle_order_check",
      sql`verified_at is null
        or revoked_at is null
        or revoked_at >= verified_at`
    ),
    check("app_external_recovery_identity_version_check", sql`version >= 1`),
    check(
      "app_external_recovery_identity_state_check",
      sql`(status = 'pending' and verified_at is null and revoked_at is null)
        or (status = 'verified' and verified_at is not null and revoked_at is null)
        or (status = 'revoked' and revoked_at is not null)`
    ),
    uniqueIndex("app_external_recovery_identity_challenge_idx").on(
      t.challengeId
    ),
    uniqueIndex("app_external_recovery_identity_operation_idx").on(
      t.enrollmentOperationId
    ),
    index("app_external_recovery_identity_pending_user_expiry_idx")
      .on(t.userId, t.challengeExpiresAt)
      .where(sql`status = 'pending'`),
    uniqueIndex("app_external_recovery_identity_verified_user_idx")
      .on(t.userId)
      .where(sql`status = 'verified'`),
    uniqueIndex("app_external_recovery_identity_verified_address_idx")
      .on(t.comparisonKey)
      .where(sql`status = 'verified'`),
    index("app_external_recovery_identity_pending_address_expiry_idx")
      .on(t.comparisonKey, t.challengeExpiresAt)
      .where(sql`status = 'pending'`),
    index("app_external_recovery_identity_pending_expiry_idx")
      .on(t.challengeExpiresAt)
      .where(sql`status = 'pending'`),
  ]
);

export const appExternalRecoveryOperationReceipt = sqliteTable(
  "app_external_recovery_operation_receipt",
  {
    operationId: text("operation_id").primaryKey(),
    operationKind: text("operation_kind", {
      enum: ["enroll", "verify"],
    }).notNull(),
    actorUserId: text("actor_user_id").notNull(),
    identityId: text("identity_id").notNull(),
    challengeId: text("challenge_id"),
    expectedIdentityVersion: integer("expected_identity_version"),
    verificationSecretHash: text("verification_secret_hash"),
    resultUserId: text("result_user_id").notNull(),
    resultStatus: text("result_status", {
      enum: ["pending", "verified"],
    }).notNull(),
    resultChallengeExpiresAt: integer("result_challenge_expires_at").notNull(),
    resultCreatedAt: integer("result_created_at").notNull(),
    resultUpdatedAt: integer("result_updated_at").notNull(),
    resultVerifiedAt: integer("result_verified_at"),
    resultRevokedAt: integer("result_revoked_at"),
    resultVersion: integer("result_version").notNull(),
    committedAt: integer("committed_at").notNull(),
    schemaVersion: integer("schema_version").notNull(),
  },
  (t) => [
    check(
      "app_external_recovery_operation_receipt_operation_id_check",
      sql`length(operation_id) = 36
        and operation_id = lower(trim(operation_id))
        and substr(operation_id, 9, 1) = '-'
        and substr(operation_id, 14, 1) = '-'
        and substr(operation_id, 15, 1) = '4'
        and substr(operation_id, 19, 1) = '-'
        and substr(operation_id, 20, 1) in ('8', '9', 'a', 'b')
        and substr(operation_id, 24, 1) = '-'
        and length(replace(operation_id, '-', '')) = 32
        and replace(operation_id, '-', '') not glob '*[^0-9a-f]*'`
    ),
    check(
      "app_external_recovery_operation_receipt_kind_check",
      sql`operation_kind in ('enroll', 'verify')`
    ),
    check(
      "app_external_recovery_operation_receipt_actor_check",
      sql`length(actor_user_id) between 1 and 128
        and actor_user_id = trim(actor_user_id)`
    ),
    check(
      "app_external_recovery_operation_receipt_intent_check",
      sql`length(identity_id) between 1 and 128
        and ((operation_kind = 'enroll'
          and challenge_id is null
          and expected_identity_version is null
          and verification_secret_hash is null
          and result_status = 'pending'
          and result_verified_at is null
          and result_revoked_at is null
          and result_version = 1)
        or (operation_kind = 'verify'
          and length(challenge_id) between 1 and 128
          and expected_identity_version >= 1
          and length(verification_secret_hash) between 1 and 512
          and result_status = 'verified'
          and result_verified_at is not null
          and result_revoked_at is null
          and result_version = expected_identity_version + 1))`
    ),
    check(
      "app_external_recovery_operation_receipt_result_check",
      sql`result_user_id = actor_user_id
        and result_challenge_expires_at > result_created_at
        and result_created_at >= 0
        and result_updated_at >= result_created_at
        and (result_verified_at is null
          or result_verified_at between result_created_at and result_updated_at)
        and result_revoked_at is null
        and committed_at = result_updated_at
        and schema_version = 1`
    ),
    index("app_external_recovery_operation_receipt_actor_operation_idx").on(
      t.actorUserId,
      t.operationId
    ),
  ]
);

export const appPasskeyCredentialRevocation = sqliteTable(
  "app_passkey_credential_revocation",
  {
    operationId: text("operation_id").primaryKey(),
    userId: text("user_id").notNull(),
    credentialRecordId: text("credential_record_id").notNull().unique(),
    credentialCreatedAt: integer("credential_created_at").notNull(),
    credentialLastUsedAt: integer("credential_last_used_at"),
    revokedAt: integer("revoked_at").notNull(),
  },
  (t) => [
    check(
      "app_passkey_credential_revocation_operation_id_check",
      sql`length(operation_id) = 36
        and operation_id = lower(trim(operation_id))
        and substr(operation_id, 9, 1) = '-'
        and substr(operation_id, 14, 1) = '-'
        and substr(operation_id, 15, 1) = '4'
        and substr(operation_id, 19, 1) = '-'
        and substr(operation_id, 20, 1) in ('8', '9', 'a', 'b')
        and substr(operation_id, 24, 1) = '-'
        and length(replace(operation_id, '-', '')) = 32
        and replace(operation_id, '-', '') not glob '*[^0-9a-f]*'`
    ),
    check(
      "app_passkey_credential_revocation_user_check",
      sql`length(user_id) between 1 and 128 and user_id = trim(user_id)`
    ),
    check(
      "app_passkey_credential_revocation_credential_check",
      sql`length(credential_record_id) between 1 and 256
        and credential_record_id = trim(credential_record_id)`
    ),
    check(
      "app_passkey_credential_revocation_time_check",
      sql`credential_created_at >= 0 and revoked_at >= credential_created_at
        and (credential_last_used_at is null
          or credential_last_used_at between credential_created_at and revoked_at)`
    ),
    index("app_passkey_credential_revocation_user_operation_idx").on(
      t.userId,
      t.operationId
    ),
  ]
);

export const appDevEmailMessage = sqliteTable(
  "app_dev_email_message",
  {
    id: text("id").notNull(),
    kind: text("kind").notNull(),
    recipient: text("recipient").notNull(),
    messageJson: text("message_json").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [
    primaryKey({ name: "app_dev_email_message_pkey", columns: [t.id] }),
    index("app_dev_email_message_created_at_idx").on(sql`${t.createdAt} desc`),
    index("app_dev_email_message_recipient_created_at_idx").on(
      t.recipient,
      sql`${t.createdAt} desc`
    ),
  ]
);
