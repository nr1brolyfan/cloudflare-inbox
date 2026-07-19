// Generated from @effect-auth/core@0.1.0-alpha.19.
// Do not edit manually; run `bun run generate:auth-schema`.

import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const authPermissionDefinition = sqliteTable(
  "auth_permission_definition",
  {
    id: text("id").notNull(),
    description: text("description"),
    scopeTypePresent: integer("scope_type_present").notNull(),
    scopeType: text("scope_type").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    disabledAt: integer("disabled_at"),
    deletedAt: integer("deleted_at"),
  },
  (t) => [primaryKey({ name: "auth_permission_definition_pkey", columns: [t.id] })],
);

export const authRoleDefinition = sqliteTable(
  "auth_role_definition",
  {
    id: text("id").notNull(),
    description: text("description"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    disabledAt: integer("disabled_at"),
    deletedAt: integer("deleted_at"),
  },
  (t) => [primaryKey({ name: "auth_role_definition_pkey", columns: [t.id] })],
);

export const authPermissionGrant = sqliteTable(
  "auth_permission_grant",
  {
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    permissionId: text("permission_id").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeIdPresent: integer("scope_id_present").notNull(),
    scopeId: text("scope_id").notNull(),
    expiresAt: integer("expires_at"),
    metadata: text("metadata"),
    revokedAt: integer("revoked_at"),
  },
  (t) => [
    primaryKey({
      name: "auth_permission_grant_pkey",
      columns: [
        t.subjectType,
        t.subjectId,
        t.permissionId,
        t.scopeType,
        t.scopeIdPresent,
        t.scopeId,
      ],
    }),
    index("auth_permission_grant_check_idx").on(
      t.subjectType,
      t.subjectId,
      t.permissionId,
      t.revokedAt,
      t.expiresAt,
    ),
  ],
);

export const authRoleGrant = sqliteTable(
  "auth_role_grant",
  {
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    roleId: text("role_id").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeIdPresent: integer("scope_id_present").notNull(),
    scopeId: text("scope_id").notNull(),
    expiresAt: integer("expires_at"),
    metadata: text("metadata"),
    revokedAt: integer("revoked_at"),
  },
  (t) => [
    primaryKey({
      name: "auth_role_grant_pkey",
      columns: [t.subjectType, t.subjectId, t.roleId, t.scopeType, t.scopeIdPresent, t.scopeId],
    }),
    index("auth_role_grant_check_idx").on(
      t.subjectType,
      t.subjectId,
      t.roleId,
      t.revokedAt,
      t.expiresAt,
    ),
  ],
);

export const authRolePermission = sqliteTable(
  "auth_role_permission",
  {
    roleId: text("role_id").notNull(),
    permissionId: text("permission_id").notNull(),
    scopeTypePresent: integer("scope_type_present").notNull(),
    scopeType: text("scope_type").notNull(),
  },
  (t) => [
    primaryKey({
      name: "auth_role_permission_pkey",
      columns: [t.roleId, t.permissionId, t.scopeTypePresent, t.scopeType],
    }),
    index("auth_role_permission_check_idx").on(
      t.permissionId,
      t.roleId,
      t.scopeTypePresent,
      t.scopeType,
    ),
  ],
);
