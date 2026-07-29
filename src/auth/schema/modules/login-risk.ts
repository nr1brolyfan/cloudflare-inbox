// Generated from @effect-auth/core@0.1.0-alpha.20.
// Do not edit manually; run `bun run generate:auth-schema`.

import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
    check(
      "auth_login_risk_history_id_check",
      sql`length(id) between 1 and 256 and substr(id, 1, 1) not glob '*[^A-Za-z0-9]*' and id not glob '*[^A-Za-z0-9_.:@/-]*'`,
    ),
    check(
      "auth_login_risk_history_user_id_check",
      sql`length(user_id) between 1 and 256 and substr(user_id, 1, 1) not glob '*[^A-Za-z0-9]*' and user_id not glob '*[^A-Za-z0-9_.:@/-]*'`,
    ),
    check(
      "auth_login_risk_history_timestamp_check",
      sql`occurred_at between 0 and 9007199254740991 and created_at between occurred_at and 9007199254740991`,
    ),
    check("auth_login_risk_history_outcome_check", sql`outcome in ('success', 'failure')`),
    check(
      "auth_login_risk_history_method_check",
      sql`length(method) between 1 and 128 and substr(method, 1, 1) not glob '*[^A-Za-z0-9]*' and method not glob '*[^A-Za-z0-9_.:@/-]*'`,
    ),
    check(
      "auth_login_risk_history_amr_check",
      sql`json_valid(amr) and json_type(amr) = 'array' and json_array_length(amr) <= 32`,
    ),
    check("auth_login_risk_history_aal_check", sql`aal in ('aal1', 'aal2', 'aal3')`),
    check(
      "auth_login_risk_history_device_status_check",
      sql`device_status in ('known', 'new', 'unknown')`,
    ),
    check(
      "auth_login_risk_history_device_key_check",
      sql`device_key is null or (length(device_key) = 43 and device_key not glob '*[^A-Za-z0-9_-]*')`,
    ),
    check(
      "auth_login_risk_history_location_key_check",
      sql`location_key is null or (length(location_key) between 8 and 135 and substr(location_key, 1, 4) = 'geo:' and substr(location_key, 5, 2) not glob '*[^A-Z]*' and substr(location_key, 7, 1) = ':' and (substr(location_key, 8) = '_' or (length(substr(location_key, 8)) between 1 and 128 and substr(location_key, 8, 1) not glob '*[^A-Za-z0-9]*' and substr(location_key, 8) not glob '*[^A-Za-z0-9_. -]*')))`,
    ),
    check(
      "auth_login_risk_history_country_check",
      sql`country is null or (length(country) = 2 and country not glob '*[^A-Z]*')`,
    ),
    check(
      "auth_login_risk_history_region_check",
      sql`region is null or (length(region) between 1 and 128 and substr(region, 1, 1) not glob '*[^A-Za-z0-9]*' and region not glob '*[^A-Za-z0-9_. -]*')`,
    ),
    check(
      "auth_login_risk_history_coordinates_check",
      sql`(latitude_micro is null) = (longitude_micro is null) and (latitude_micro is null or latitude_micro between -90000000 and 90000000) and (longitude_micro is null or longitude_micro between -180000000 and 180000000)`,
    ),
    check(
      "auth_login_risk_history_risk_level_check",
      sql`risk_level is null or risk_level in ('unknown', 'low', 'medium', 'high', 'critical')`,
    ),
    index("auth_login_risk_history_user_occurred_at_idx").on(t.userId, t.occurredAt, t.id),
    index("auth_login_risk_history_user_device_key_idx").on(t.userId, t.deviceKey),
    index("auth_login_risk_history_user_location_key_idx").on(t.userId, t.locationKey),
    index("auth_login_risk_history_occurred_at_idx").on(t.occurredAt, t.id),
  ],
);

export const authLoginRiskHistoryQuarantine = sqliteTable(
  "auth_login_risk_history_quarantine",
  {
    id: text("id"),
    userId: text("user_id"),
    occurredAt: integer("occurred_at"),
    outcome: text("outcome"),
    method: text("method"),
    amr: text("amr"),
    aal: text("aal"),
    deviceStatus: text("device_status"),
    deviceKey: text("device_key"),
    locationKey: text("location_key"),
    country: text("country"),
    region: text("region"),
    latitudeMicro: integer("latitude_micro"),
    longitudeMicro: integer("longitude_micro"),
    riskLevel: text("risk_level"),
    createdAt: integer("created_at"),
    quarantinedReason: text("quarantined_reason").notNull(),
  },
  (_t) => [],
);
