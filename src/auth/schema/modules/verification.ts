// Generated from @effect-auth/core@0.1.0-alpha.19.
// Do not edit manually; run `bun run generate:auth-schema`.

import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const authVerification = sqliteTable(
  "auth_verification",
  {
    id: text("id").notNull(),
    type: text("type").notNull(),
    subject: text("subject").notNull(),
    secretHash: text("secret_hash"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    metadata: text("metadata"),
    consumedAt: integer("consumed_at"),
  },
  (t) => [
    primaryKey({ name: "auth_verification_pkey", columns: [t.id] }),
    index("auth_verification_type_subject_idx").on(t.type, t.subject),
    index("auth_verification_expires_at_idx").on(t.expiresAt),
  ],
);
