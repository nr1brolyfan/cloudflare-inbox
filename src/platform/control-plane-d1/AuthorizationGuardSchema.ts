import { sql } from "drizzle-orm";
import { check, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Technical nonce used to carry authorization across one atomic D1 batch. */
export const appAuthorizationGuard = sqliteTable(
  "app_authorization_guard",
  {
    nonce: text("nonce").notNull(),
  },
  (t) => [
    primaryKey({ name: "app_authorization_guard_pkey", columns: [t.nonce] }),
    check(
      "app_authorization_guard_nonce_check",
      sql`length(nonce) between 1 and 128`
    ),
  ]
);
