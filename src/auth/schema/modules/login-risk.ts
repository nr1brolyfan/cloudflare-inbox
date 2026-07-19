// Generated from @effect-auth/core@0.1.0-alpha.19.
// Do not edit manually; run `bun run generate:auth-schema`.

import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const authLoginRiskHistory = sqliteTable(
  "auth_login_risk_history",
  {
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    occurredAt: integer("occurred_at").notNull(),
    outcome: text("outcome").notNull(),
    method: text("method").notNull(),
    amr: text("amr").notNull(),
    aal: text("aal").notNull(),
    deviceStatus: text("device_status").notNull(),
    deviceKey: text("device_key"),
    locationKey: text("location_key"),
    country: text("country"),
    region: text("region"),
    latitudeMicro: integer("latitude_micro"),
    longitudeMicro: integer("longitude_micro"),
    riskLevel: text("risk_level"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    primaryKey({ name: "auth_login_risk_history_pkey", columns: [t.id] }),
    index("auth_login_risk_history_user_occurred_at_idx").on(t.userId, t.occurredAt),
    index("auth_login_risk_history_user_device_key_idx").on(t.userId, t.deviceKey),
    index("auth_login_risk_history_user_location_key_idx").on(t.userId, t.locationKey),
    index("auth_login_risk_history_occurred_at_idx").on(t.occurredAt),
  ],
);
