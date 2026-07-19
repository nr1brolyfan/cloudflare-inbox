// Generated from @effect-auth/core@0.1.0-alpha.19.
// Do not edit manually; run `bun run generate:auth-schema`.

import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const authSecurityTimeline = sqliteTable(
  "auth_security_timeline",
  {
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    type: text("type").notNull(),
    category: text("category").notNull(),
    severity: text("severity").notNull(),
    occurredAt: integer("occurred_at").notNull(),
    summary: text("summary").notNull(),
    actor: text("actor"),
    request: text("request"),
    metadata: text("metadata"),
  },
  (t) => [
    primaryKey({ name: "auth_security_timeline_pkey", columns: [t.id] }),
    index("auth_security_timeline_user_occurred_at_idx").on(t.userId, t.occurredAt),
    index("auth_security_timeline_type_idx").on(t.type),
    index("auth_security_timeline_category_idx").on(t.category),
  ],
);
