// Generated from @effect-auth/core@0.1.0-alpha.19.
// Do not edit manually; run `bun run generate:auth-schema`.

import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const authLoginApprovalReview = sqliteTable(
  "auth_login_approval_review",
  {
    approvalChallengeId: text("approval_challenge_id").notNull(),
    flowId: text("flow_id").notNull(),
    userId: text("user_id").notNull(),
    channel: text("channel").notNull(),
    reason: text("reason").notNull(),
    sessionBinding: text("session_binding").notNull(),
    sameDeviceRequired: integer("same_device_required").notNull(),
    status: text("status").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    reviewedAt: integer("reviewed_at"),
    reviewedBy: text("reviewed_by"),
    deniedReason: text("denied_reason"),
    risk: text("risk"),
    metadata: text("metadata"),
    reviewMetadata: text("review_metadata"),
  },
  (t) => [
    primaryKey({ name: "auth_login_approval_review_pkey", columns: [t.approvalChallengeId] }),
    index("auth_login_approval_review_flow_id_idx").on(t.flowId),
    index("auth_login_approval_review_user_id_idx").on(t.userId),
    index("auth_login_approval_review_status_expires_at_idx").on(t.status, t.expiresAt),
  ],
);
