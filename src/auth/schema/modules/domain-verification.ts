// Generated from @effect-auth/core@0.1.0-alpha.20.
// Do not edit manually; run `bun run generate:auth-schema`.

import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const authDomainVerification = sqliteTable(
  "auth_domain_verification",
  {
    id: text("id").notNull(),
    ownerId: text("owner_id").notNull(),
    domain: text("domain").notNull(),
    proofMethod: text("proof_method").notNull(),
    proofToken: text("proof_token").notNull(),
    status: text("status").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    verifiedAt: integer("verified_at"),
    revokedAt: integer("revoked_at"),
    lastCheckedAt: integer("last_checked_at"),
    metadata: text("metadata"),
  },
  (t) => [
    primaryKey({ name: "auth_domain_verification_pkey", columns: [t.id] }),
    uniqueIndex("auth_domain_verification_owner_domain_idx").on(t.ownerId, t.domain),
    index("auth_domain_verification_domain_idx").on(t.domain),
    index("auth_domain_verification_status_expires_at_idx").on(t.status, t.expiresAt),
  ],
);
