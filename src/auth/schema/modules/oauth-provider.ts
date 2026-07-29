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
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const authOauthClient = sqliteTable(
  "auth_oauth_client",
  {
    id: text("id").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull(),
    name: text("name"),
    redirectUris: text("redirect_uris").notNull(),
    allowedGrantTypes: text("allowed_grant_types").notNull(),
    allowedResponseTypes: text("allowed_response_types").notNull(),
    allowedScopes: text("allowed_scopes"),
    createdAt: integer("created_at"),
    updatedAt: integer("updated_at"),
    metadata: text("metadata"),
  },
  (t) => [
    primaryKey({ name: "auth_oauth_client_pkey", columns: [t.id] }),
    index("auth_oauth_client_status_idx").on(t.status),
  ],
);

export const authOauthConsent = sqliteTable(
  "auth_oauth_consent",
  {
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    clientId: text("client_id").notNull(),
    scopes: text("scopes").notNull(),
    grantedAt: integer("granted_at").notNull(),
    expiresAt: integer("expires_at"),
    revokedAt: integer("revoked_at"),
    metadata: text("metadata"),
  },
  (t) => [
    primaryKey({ name: "auth_oauth_consent_pkey", columns: [t.id] }),
    uniqueIndex("auth_oauth_consent_user_client_idx").on(t.userId, t.clientId),
    index("auth_oauth_consent_user_id_idx").on(t.userId),
    index("auth_oauth_consent_expires_at_idx").on(t.expiresAt),
    index("auth_oauth_consent_revoked_at_idx").on(t.revokedAt),
  ],
);

export const authOauthAuthorizationCode = sqliteTable(
  "auth_oauth_authorization_code",
  {
    codeHash: text("code_hash").notNull(),
    clientId: text("client_id").notNull(),
    subject: text("subject").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    scopes: text("scopes").notNull(),
    codeChallenge: text("code_challenge"),
    codeChallengeMethod: text("code_challenge_method"),
    issuedAt: integer("issued_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
    metadata: text("metadata"),
  },
  (t) => [
    primaryKey({ name: "auth_oauth_authorization_code_pkey", columns: [t.codeHash] }),
    index("auth_oauth_authorization_code_client_expires_at_idx").on(t.clientId, t.expiresAt),
    index("auth_oauth_authorization_code_expires_at_idx").on(t.expiresAt),
    index("auth_oauth_authorization_code_consumed_at_idx").on(t.consumedAt),
  ],
);

export const authOauthClientSecret = sqliteTable(
  "auth_oauth_client_secret",
  {
    prefix: text("prefix").notNull(),
    clientId: text("client_id").notNull(),
    secretHash: text("secret_hash").notNull(),
    authenticationMethods: text("authentication_methods").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at"),
    lastUsedAt: integer("last_used_at"),
    revokedAt: integer("revoked_at"),
    metadata: text("metadata"),
  },
  (t) => [primaryKey({ name: "auth_oauth_client_secret_pkey", columns: [t.clientId, t.prefix] })],
);

export const authOauthProviderModeToken = sqliteTable(
  "auth_oauth_provider_mode_token",
  {
    tokenHash: text("token_hash").notNull(),
    tokenType: text("token_type").notNull(),
    clientId: text("client_id").notNull(),
    subject: text("subject").notNull(),
    scopes: text("scopes").notNull(),
    issuedAt: integer("issued_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    issuer: text("issuer"),
    audience: text("audience"),
    jwtId: text("jwt_id"),
    revokedAt: integer("revoked_at"),
    revocationReason: text("revocation_reason"),
    rotatedAt: integer("rotated_at"),
    replacedByTokenHash: text("replaced_by_token_hash"),
    metadata: text("metadata"),
    familyId: text("family_id"),
  },
  (t) => [
    primaryKey({ name: "auth_oauth_provider_mode_token_pkey", columns: [t.tokenHash] }),
    index("auth_oauth_provider_mode_token_client_expires_at_idx").on(t.clientId, t.expiresAt),
    index("auth_oauth_provider_mode_token_subject_idx").on(t.subject),
    index("auth_oauth_provider_mode_token_expires_at_idx").on(t.expiresAt),
    index("auth_oauth_provider_mode_token_revoked_at_idx").on(t.revokedAt),
    index("auth_oauth_provider_mode_token_rotated_at_idx").on(t.rotatedAt),
    index("auth_oauth_provider_mode_token_jwt_id_idx").on(t.jwtId),
    index("auth_oauth_provider_mode_token_family_id_idx").on(t.familyId),
  ],
);

export const authOauthProviderModeRefreshFamily = sqliteTable(
  "auth_oauth_provider_mode_refresh_family",
  {
    familyId: text("family_id").notNull(),
    clientId: text("client_id").notNull(),
    subject: text("subject").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    version: integer("version").notNull().default(0),
    revokedAt: integer("revoked_at"),
    reuseDetectedAt: integer("reuse_detected_at"),
    revocationReason: text("revocation_reason"),
    metadata: text("metadata"),
  },
  (t) => [
    primaryKey({ name: "auth_oauth_provider_mode_refresh_family_pkey", columns: [t.familyId] }),
    check("auth_oauth_provider_mode_refresh_family_version_check", sql`version >= 0`),
    check("auth_oauth_provider_mode_refresh_family_expiry_check", sql`expires_at > created_at`),
    check(
      "auth_oauth_provider_mode_refresh_family_reuse_check",
      sql`reuse_detected_at is null or revoked_at is not null`,
    ),
    index("auth_oauth_provider_mode_refresh_family_client_idx").on(t.clientId),
    index("auth_oauth_provider_mode_refresh_family_subject_idx").on(t.subject),
    index("auth_oauth_provider_mode_refresh_family_expires_at_idx").on(t.expiresAt),
    index("auth_oauth_provider_mode_refresh_family_revoked_at_idx").on(t.revokedAt),
  ],
);

export const authOauthDeviceAuthorization = sqliteTable(
  "auth_oauth_device_authorization",
  {
    id: text("id").notNull(),
    deviceCodeHash: text("device_code_hash").notNull(),
    userCodeHash: text("user_code_hash").notNull(),
    clientId: text("client_id").notNull(),
    requestedScopes: text("requested_scopes").notNull(),
    grantedScopes: text("granted_scopes"),
    subject: text("subject"),
    status: text("status").notNull(),
    issuedAt: integer("issued_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    pollIntervalSeconds: integer("poll_interval_seconds").notNull(),
    nextPollAt: integer("next_poll_at").notNull(),
    lastPolledAt: integer("last_polled_at"),
    approvedAt: integer("approved_at"),
    deniedAt: integer("denied_at"),
    consumedAt: integer("consumed_at"),
    metadata: text("metadata"),
  },
  (t) => [
    primaryKey({ name: "auth_oauth_device_authorization_pkey", columns: [t.id] }),
    unique("auth_oauth_device_authorization_device_code_hash_key").on(t.deviceCodeHash),
    unique("auth_oauth_device_authorization_user_code_hash_key").on(t.userCodeHash),
    check(
      "auth_oauth_device_authorization_requested_scopes_check",
      sql`json_valid(requested_scopes) and json_type(requested_scopes) = 'array'`,
    ),
    check(
      "auth_oauth_device_authorization_granted_scopes_check",
      sql`granted_scopes is null or (json_valid(granted_scopes) and json_type(granted_scopes) = 'array')`,
    ),
    check(
      "auth_oauth_device_authorization_status_check",
      sql`status in ('pending', 'approved', 'denied')`,
    ),
    check(
      "auth_oauth_device_authorization_poll_interval_seconds_check",
      sql`poll_interval_seconds > 0`,
    ),
    check(
      "auth_oauth_device_authorization_metadata_check",
      sql`metadata is null or (json_valid(metadata) and json_type(metadata) = 'object')`,
    ),
    check(
      "auth_oauth_device_authorization_state_check",
      sql`(status = 'pending' and granted_scopes is null and subject is null and approved_at is null and denied_at is null and consumed_at is null)
    or (status = 'approved' and granted_scopes is not null and subject is not null and approved_at is not null and denied_at is null)
    or (status = 'denied' and granted_scopes is null and subject is null and approved_at is null and denied_at is not null and consumed_at is null)`,
    ),
    index("auth_oauth_device_authorization_expires_at_idx").on(t.expiresAt),
    index("auth_oauth_device_authorization_client_status_expires_at_idx").on(
      t.clientId,
      t.status,
      t.expiresAt,
    ),
    index("auth_oauth_device_authorization_status_expires_at_idx").on(t.status, t.expiresAt),
  ],
);
