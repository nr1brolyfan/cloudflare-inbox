// Generated from @effect-auth/core@0.1.0-alpha.20.
// Do not edit manually; run `bun run generate:auth-schema`.

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

export const authPasskeyCredential = sqliteTable(
  "auth_passkey_credential",
  {
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    credentialId: text("credential_id").notNull(),
    publicKey: text("public_key").notNull(),
    signCount: integer("sign_count").notNull(),
    transports: text("transports"),
    backedUp: integer("backed_up"),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at"),
    revokedAt: integer("revoked_at"),
    metadata: text("metadata"),
    name: text("name"),
  },
  (t) => [
    primaryKey({ name: "auth_passkey_credential_pkey", columns: [t.id] }),
    check(
      "auth_passkey_credential_id_check",
      sql`typeof(id) = 'text' and length(cast(id as blob)) between 1 and 256`,
    ),
    check(
      "auth_passkey_credential_user_id_check",
      sql`typeof(user_id) = 'text' and length(cast(user_id as blob)) between 1 and 256`,
    ),
    check(
      "auth_passkey_credential_credential_id_check",
      sql`typeof(credential_id) = 'text' and length(credential_id) between 1 and 1364 and length(credential_id) % 4 != 1 and credential_id not glob '*[^A-Za-z0-9_-]*' and (length(credential_id) % 4 = 0 or (length(credential_id) % 4 = 2 and substr(credential_id, -1, 1) glob '[AQgw]') or (length(credential_id) % 4 = 3 and substr(credential_id, -1, 1) glob '[AEIMQUYcgkosw048]'))`,
    ),
    check(
      "auth_passkey_credential_public_key_check",
      sql`typeof(public_key) = 'text' and length(public_key) between 1 and 10923 and length(public_key) % 4 != 1 and public_key not glob '*[^A-Za-z0-9_-]*' and (length(public_key) % 4 = 0 or (length(public_key) % 4 = 2 and substr(public_key, -1, 1) glob '[AQgw]') or (length(public_key) % 4 = 3 and substr(public_key, -1, 1) glob '[AEIMQUYcgkosw048]'))`,
    ),
    check(
      "auth_passkey_credential_sign_count_check",
      sql`typeof(sign_count) = 'integer' and sign_count between 0 and 9007199254740991`,
    ),
    check(
      "auth_passkey_credential_transports_check",
      sql`transports is null or (typeof(transports) = 'text' and json_valid(transports) = 1 and json_type(transports) = 'array' and json_array_length(transports) <= 7 and json(transports) = transports and replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(transports, '[', ''), ']', ''), ',', ''), '"ble"', ''), '"cable"', ''), '"hybrid"', ''), '"internal"', ''), '"nfc"', ''), '"smart-card"', ''), '"usb"', '') = '' and length(transports) - length(replace(transports, '"ble"', '')) <= 5 and length(transports) - length(replace(transports, '"cable"', '')) <= 7 and length(transports) - length(replace(transports, '"hybrid"', '')) <= 8 and length(transports) - length(replace(transports, '"internal"', '')) <= 10 and length(transports) - length(replace(transports, '"nfc"', '')) <= 5 and length(transports) - length(replace(transports, '"smart-card"', '')) <= 12 and length(transports) - length(replace(transports, '"usb"', '')) <= 5)`,
    ),
    check(
      "auth_passkey_credential_backed_up_check",
      sql`backed_up is null or (typeof(backed_up) = 'integer' and backed_up in (0, 1))`,
    ),
    check(
      "auth_passkey_credential_created_at_check",
      sql`typeof(created_at) = 'integer' and created_at between 0 and 9007199254740991`,
    ),
    check(
      "auth_passkey_credential_last_used_at_check",
      sql`last_used_at is null or (typeof(last_used_at) = 'integer' and last_used_at between created_at and 9007199254740991)`,
    ),
    check(
      "auth_passkey_credential_revoked_at_check",
      sql`revoked_at is null or (typeof(revoked_at) = 'integer' and revoked_at between created_at and 9007199254740991)`,
    ),
    check(
      "auth_passkey_credential_metadata_check",
      sql`metadata is null or (typeof(metadata) = 'text' and length(cast(metadata as blob)) <= 65536 and json_valid(metadata) = 1 and json_type(metadata) = 'object')`,
    ),
    check(
      "auth_passkey_credential_name_check",
      sql`name is null or (typeof(name) = 'text' and length(name) between 1 and 100 and length(cast(name as blob)) <= 400)`,
    ),
    uniqueIndex("auth_passkey_credential_credential_id_idx").on(t.credentialId),
    index("auth_passkey_credential_user_id_idx").on(t.userId),
    index("auth_passkey_credential_revoked_at_idx").on(t.revokedAt),
  ],
);

export const authPasskeyCredentialHardeningGuard = sqliteTable(
  "auth_passkey_credential_hardening_guard",
  {
    version: integer("version").notNull(),
  },
  (t) => [
    primaryKey({ name: "auth_passkey_credential_hardening_guard_pkey", columns: [t.version] }),
    check("auth_passkey_credential_hardening_guard_version_check", sql`version = 1`),
  ],
);

export const authPasskeyCredentialQuarantine = sqliteTable(
  "auth_passkey_credential_quarantine",
  {
    id: text("id"),
    userId: text("user_id"),
    credentialId: text("credential_id"),
    publicKey: text("public_key"),
    signCount: integer("sign_count"),
    transports: text("transports"),
    backedUp: integer("backed_up"),
    createdAt: integer("created_at"),
    lastUsedAt: integer("last_used_at"),
    revokedAt: integer("revoked_at"),
    metadata: text("metadata"),
    name: text("name"),
    quarantineReason: text("quarantine_reason").notNull(),
  },
  (_t) => [],
);
