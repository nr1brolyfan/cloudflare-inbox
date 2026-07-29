import {
  PermissionId,
  RoleId,
  UnixMillis,
} from "@effect-auth/core/Identifiers";
import {
  canonicalPermissionScope,
  normalizePermissionDefinitionListLimit,
  PermissionStore,
  PermissionStoreError,
} from "@effect-auth/core/Permission";
import type {
  GrantActivity,
  PermissionDefinitionRecord,
  PermissionGrant,
  PermissionGrantInput,
  PermissionGrantListInput,
  PermissionScope,
  PermissionStoreOperation,
  PermissionStoreService,
  RoleDefinitionRecord,
  RoleGrant,
  RoleGrantInput,
  RoleGrantListInput,
  RolePermission,
} from "@effect-auth/core/Permission";
import {
  and,
  asc,
  eq,
  exists,
  gt,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  authPermissionDefinition,
  authPermissionGrant,
  authRoleDefinition,
  authRoleGrant,
  authRolePermission,
} from "#/auth/schema/modules/permissions";
import { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";

const storeError = (operation: PermissionStoreOperation, cause: unknown) =>
  new PermissionStoreError({
    cause,
    message: `Permission store ${operation} failed`,
    operation,
  });

const optionalMillis = (value: number | null) =>
  value === null ? undefined : UnixMillis(value);

const omitUndefined = <A extends Record<string, unknown>>(value: A) =>
  Object.fromEntries(
    Object.entries(value).filter(([, member]) => member !== undefined)
  ) as A;

const decodePermissionDefinition = (
  row: typeof authPermissionDefinition.$inferSelect
): PermissionDefinitionRecord =>
  omitUndefined({
    id: PermissionId(row.id),
    description: row.description ?? undefined,
    scopeType: row.scopeTypePresent === 0 ? undefined : row.scopeType,
    createdAt: UnixMillis(row.createdAt),
    updatedAt: UnixMillis(row.updatedAt),
    disabledAt: optionalMillis(row.disabledAt),
    deletedAt: optionalMillis(row.deletedAt),
  });

const decodeRoleDefinition = (
  row: typeof authRoleDefinition.$inferSelect
): RoleDefinitionRecord =>
  omitUndefined({
    id: RoleId(row.id),
    description: row.description ?? undefined,
    createdAt: UnixMillis(row.createdAt),
    updatedAt: UnixMillis(row.updatedAt),
    disabledAt: optionalMillis(row.disabledAt),
    deletedAt: optionalMillis(row.deletedAt),
  });

const decodeScope = (
  type: string,
  idPresent: number,
  id: string
): PermissionScope | undefined => {
  if (type === "global" && idPresent === 0) {
    return undefined;
  }
  return idPresent === 0 ? { type } : { id, type };
};

const decodeMetadata = (metadata: string | null) => {
  if (metadata === null) {
    return;
  }
  const decoded: unknown = JSON.parse(metadata);
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    Array.isArray(decoded)
  ) {
    throw new TypeError("Permission metadata must be an object");
  }
  return decoded as Readonly<Record<string, unknown>>;
};

const decodePermissionGrant = (
  row: typeof authPermissionGrant.$inferSelect
): PermissionGrant =>
  omitUndefined({
    subject: { id: row.subjectId, type: row.subjectType },
    permission: PermissionId(row.permissionId),
    scope: decodeScope(row.scopeType, row.scopeIdPresent, row.scopeId),
    expiresAt: optionalMillis(row.expiresAt),
    metadata: decodeMetadata(row.metadata),
    revokedAt: optionalMillis(row.revokedAt),
  });

const decodeRoleGrant = (row: typeof authRoleGrant.$inferSelect): RoleGrant =>
  omitUndefined({
    subject: { id: row.subjectId, type: row.subjectType },
    role: RoleId(row.roleId),
    scope: decodeScope(row.scopeType, row.scopeIdPresent, row.scopeId),
    expiresAt: optionalMillis(row.expiresAt),
    metadata: decodeMetadata(row.metadata),
    revokedAt: optionalMillis(row.revokedAt),
  });

const decodeRolePermission = (
  row: typeof authRolePermission.$inferSelect
): RolePermission =>
  omitUndefined({
    role: RoleId(row.roleId),
    permission: PermissionId(row.permissionId),
    scopeType: row.scopeTypePresent === 0 ? undefined : row.scopeType,
  });

const scopeValues = (input: PermissionScope | undefined) => {
  const scope = canonicalPermissionScope(input);
  return {
    scopeId: scope?.id ?? "",
    scopeIdPresent: scope?.id === undefined ? 0 : 1,
    scopeType: scope?.type ?? "global",
  };
};

const scopePredicate = (
  table: typeof authPermissionGrant | typeof authRoleGrant,
  scope: PermissionScope | undefined
) => {
  const values = scopeValues(scope);
  return and(
    eq(table.scopeType, values.scopeType),
    eq(table.scopeIdPresent, values.scopeIdPresent),
    eq(table.scopeId, values.scopeId)
  );
};

const inheritedScopePredicate = (
  table: typeof authPermissionGrant | typeof authRoleGrant,
  scope: PermissionScope | undefined
) =>
  or(
    and(eq(table.scopeType, "global"), eq(table.scopeIdPresent, 0)),
    scopePredicate(table, scope)
  );

const activityPredicate = (
  table: typeof authPermissionGrant | typeof authRoleGrant,
  activity: GrantActivity,
  at: number
) => {
  const active = and(
    isNull(table.revokedAt),
    or(isNull(table.expiresAt), gt(table.expiresAt, at))
  );
  return activity === "all"
    ? undefined
    : activity === "active"
      ? active
      : or(isNotNull(table.revokedAt), lte(table.expiresAt, at));
};

const permissionDefinitionValues = (
  definition: PermissionDefinitionRecord
) => ({
  id: definition.id,
  description: definition.description ?? null,
  scopeTypePresent: definition.scopeType === undefined ? 0 : 1,
  scopeType: definition.scopeType ?? "",
  createdAt: Number(definition.createdAt),
  updatedAt: Number(definition.updatedAt),
  disabledAt:
    definition.disabledAt === undefined ? null : Number(definition.disabledAt),
  deletedAt:
    definition.deletedAt === undefined ? null : Number(definition.deletedAt),
});

const roleDefinitionValues = (definition: RoleDefinitionRecord) => ({
  id: definition.id,
  description: definition.description ?? null,
  createdAt: Number(definition.createdAt),
  updatedAt: Number(definition.updatedAt),
  disabledAt:
    definition.disabledAt === undefined ? null : Number(definition.disabledAt),
  deletedAt:
    definition.deletedAt === undefined ? null : Number(definition.deletedAt),
});

const permissionGrantValues = (input: PermissionGrantInput) => ({
  subjectType: input.subject.type,
  subjectId: input.subject.id,
  permissionId: input.permission,
  ...scopeValues(input.scope),
  expiresAt: input.expiresAt === undefined ? null : Number(input.expiresAt),
  metadata:
    input.metadata === undefined ? null : JSON.stringify(input.metadata),
  revokedAt: null,
});

const roleGrantValues = (input: RoleGrantInput) => ({
  subjectType: input.subject.type,
  subjectId: input.subject.id,
  roleId: input.role,
  ...scopeValues(input.scope),
  expiresAt: input.expiresAt === undefined ? null : Number(input.expiresAt),
  metadata:
    input.metadata === undefined ? null : JSON.stringify(input.metadata),
  revokedAt: null,
});

const compareText = (left: string | undefined, right: string | undefined) =>
  left === right
    ? 0
    : left === undefined
      ? -1
      : right === undefined
        ? 1
        : left < right
          ? -1
          : 1;

const compareScopes = (
  left: PermissionScope | undefined,
  right: PermissionScope | undefined
) => {
  if (left === undefined || right === undefined) {
    return left === right ? 0 : left === undefined ? -1 : 1;
  }
  return compareText(left.type, right.type) || compareText(left.id, right.id);
};

const comparePermissionGrants = (
  left: PermissionGrant,
  right: PermissionGrant
) =>
  compareText(left.subject.type, right.subject.type) ||
  compareText(left.subject.id, right.subject.id) ||
  compareText(left.permission, right.permission) ||
  compareScopes(left.scope, right.scope);

const compareRoleGrants = (left: RoleGrant, right: RoleGrant) =>
  compareText(left.subject.type, right.subject.type) ||
  compareText(left.subject.id, right.subject.id) ||
  compareText(left.role, right.role) ||
  compareScopes(left.scope, right.scope);

const compareRoleDefinitions = (
  left: RoleDefinitionRecord,
  right: RoleDefinitionRecord
) => compareText(left.id, right.id);

const compareRolePermissions = (left: RolePermission, right: RolePermission) =>
  compareText(left.role, right.role) ||
  compareText(left.permission, right.permission) ||
  compareText(left.scopeType, right.scopeType);

const decodeRows = <Row, Value>(
  operation: PermissionStoreOperation,
  rows: readonly Row[],
  decode: (row: Row) => Value,
  compare: (left: Value, right: Value) => number
) =>
  Effect.try({
    try: () => rows.map(decode).sort(compare),
    catch: (cause) => storeError(operation, cause),
  });

const makePermissionStore = (
  database: ControlPlaneDatabase
): PermissionStoreService => {
  const findPermissionDefinition = (
    id: string,
    operation: PermissionStoreOperation = "find_permission_definition"
  ) =>
    database
      .select()
      .from(authPermissionDefinition)
      .where(eq(authPermissionDefinition.id, id))
      .limit(1)
      .pipe(
        Effect.mapError((cause) => storeError(operation, cause)),
        Effect.map(([row]) =>
          row === undefined
            ? Option.none()
            : Option.some(decodePermissionDefinition(row))
        )
      );

  const findRoleDefinition = (
    id: string,
    operation: PermissionStoreOperation = "find_role_definition"
  ) =>
    database
      .select()
      .from(authRoleDefinition)
      .where(eq(authRoleDefinition.id, id))
      .limit(1)
      .pipe(
        Effect.mapError((cause) => storeError(operation, cause)),
        Effect.map(([row]) =>
          row === undefined
            ? Option.none()
            : Option.some(decodeRoleDefinition(row))
        )
      );

  return PermissionStore.of({
    createPermissionDefinition: (definition) =>
      database
        .insert(authPermissionDefinition)
        .values(permissionDefinitionValues(definition))
        .onConflictDoNothing({ target: authPermissionDefinition.id })
        .returning({ id: authPermissionDefinition.id })
        .pipe(
          Effect.map((rows) => rows.length === 1),
          Effect.mapError((cause) =>
            storeError("create_permission_definition", cause)
          )
        ),
    findPermissionDefinition: (id) => findPermissionDefinition(id),
    listPermissionDefinitions: (input = {}) =>
      database
        .select()
        .from(authPermissionDefinition)
        .where(
          and(
            input.includeDisabled === true
              ? undefined
              : isNull(authPermissionDefinition.disabledAt),
            input.includeDeleted === true
              ? undefined
              : isNull(authPermissionDefinition.deletedAt),
            input.after === undefined
              ? undefined
              : gt(authPermissionDefinition.id, input.after)
          )
        )
        .orderBy(asc(authPermissionDefinition.id))
        .limit(normalizePermissionDefinitionListLimit(input.limit))
        .pipe(
          Effect.mapError((cause) =>
            storeError("list_permission_definitions", cause)
          ),
          Effect.map((rows) => rows.map(decodePermissionDefinition))
        ),
    updatePermissionDefinition: (input) => {
      const set = {
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
        ...(input.scopeType === undefined
          ? {}
          : {
              scopeType: input.scopeType ?? "",
              scopeTypePresent: input.scopeType === null ? 0 : 1,
            }),
        updatedAt: Number(input.updatedAt),
      };
      return database
        .update(authPermissionDefinition)
        .set(set)
        .where(
          and(
            eq(authPermissionDefinition.id, input.id),
            eq(
              authPermissionDefinition.updatedAt,
              Number(input.expectedUpdatedAt)
            ),
            isNull(authPermissionDefinition.deletedAt)
          )
        )
        .returning()
        .pipe(
          Effect.mapError((cause) =>
            storeError("update_permission_definition", cause)
          ),
          Effect.map(([row]) =>
            row === undefined
              ? Option.none()
              : Option.some(decodePermissionDefinition(row))
          )
        );
    },
    setPermissionDefinitionDisabled: (input) =>
      database
        .update(authPermissionDefinition)
        .set({
          disabledAt:
            input.disabledAt === undefined ? null : Number(input.disabledAt),
          updatedAt: Number(input.updatedAt),
        })
        .where(
          and(
            eq(authPermissionDefinition.id, input.id),
            eq(
              authPermissionDefinition.updatedAt,
              Number(input.expectedUpdatedAt)
            ),
            isNull(authPermissionDefinition.deletedAt)
          )
        )
        .returning()
        .pipe(
          Effect.mapError((cause) =>
            storeError("set_permission_definition_disabled", cause)
          ),
          Effect.map(([row]) =>
            row === undefined
              ? Option.none()
              : Option.some(decodePermissionDefinition(row))
          )
        ),
    deletePermissionDefinition: (input) =>
      database
        .update(authPermissionDefinition)
        .set({
          deletedAt: Number(input.deletedAt),
          updatedAt: Number(input.updatedAt),
        })
        .where(
          and(
            eq(authPermissionDefinition.id, input.id),
            eq(
              authPermissionDefinition.updatedAt,
              Number(input.expectedUpdatedAt)
            ),
            isNull(authPermissionDefinition.deletedAt)
          )
        )
        .returning()
        .pipe(
          Effect.mapError((cause) =>
            storeError("delete_permission_definition", cause)
          ),
          Effect.map(([row]) =>
            row === undefined
              ? Option.none()
              : Option.some(decodePermissionDefinition(row))
          )
        ),
    createRoleDefinition: (definition) =>
      database
        .insert(authRoleDefinition)
        .values(roleDefinitionValues(definition))
        .onConflictDoNothing({ target: authRoleDefinition.id })
        .returning({ id: authRoleDefinition.id })
        .pipe(
          Effect.map((rows) => rows.length === 1),
          Effect.mapError((cause) =>
            storeError("create_role_definition", cause)
          )
        ),
    findRoleDefinition: (id) => findRoleDefinition(id),
    listRoleDefinitions: (input = {}) =>
      database
        .select()
        .from(authRoleDefinition)
        .where(
          and(
            input.includeDisabled === true
              ? undefined
              : isNull(authRoleDefinition.disabledAt),
            input.includeDeleted === true
              ? undefined
              : isNull(authRoleDefinition.deletedAt)
          )
        )
        .orderBy(asc(authRoleDefinition.id))
        .pipe(
          Effect.mapError((cause) =>
            storeError("list_role_definitions", cause)
          ),
          Effect.flatMap((rows) =>
            decodeRows(
              "list_role_definitions",
              rows,
              decodeRoleDefinition,
              compareRoleDefinitions
            )
          )
        ),
    updateRoleDefinition: (input) =>
      database
        .update(authRoleDefinition)
        .set({
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
          updatedAt: Number(input.updatedAt),
        })
        .where(
          and(
            eq(authRoleDefinition.id, input.id),
            eq(authRoleDefinition.updatedAt, Number(input.expectedUpdatedAt)),
            isNull(authRoleDefinition.deletedAt)
          )
        )
        .returning()
        .pipe(
          Effect.mapError((cause) =>
            storeError("update_role_definition", cause)
          ),
          Effect.map(([row]) =>
            row === undefined
              ? Option.none()
              : Option.some(decodeRoleDefinition(row))
          )
        ),
    setRoleDefinitionDisabled: (input) =>
      database
        .update(authRoleDefinition)
        .set({
          disabledAt:
            input.disabledAt === undefined ? null : Number(input.disabledAt),
          updatedAt: Number(input.updatedAt),
        })
        .where(
          and(
            eq(authRoleDefinition.id, input.id),
            eq(authRoleDefinition.updatedAt, Number(input.expectedUpdatedAt)),
            isNull(authRoleDefinition.deletedAt)
          )
        )
        .returning()
        .pipe(
          Effect.mapError((cause) =>
            storeError("set_role_definition_disabled", cause)
          ),
          Effect.map(([row]) =>
            row === undefined
              ? Option.none()
              : Option.some(decodeRoleDefinition(row))
          )
        ),
    deleteRoleDefinition: (input) =>
      database
        .update(authRoleDefinition)
        .set({
          deletedAt: Number(input.deletedAt),
          updatedAt: Number(input.updatedAt),
        })
        .where(
          and(
            eq(authRoleDefinition.id, input.id),
            eq(authRoleDefinition.updatedAt, Number(input.expectedUpdatedAt)),
            isNull(authRoleDefinition.deletedAt)
          )
        )
        .returning()
        .pipe(
          Effect.mapError((cause) =>
            storeError("delete_role_definition", cause)
          ),
          Effect.map(([row]) =>
            row === undefined
              ? Option.none()
              : Option.some(decodeRoleDefinition(row))
          )
        ),
    grantPermission: (input) =>
      Effect.try({
        try: () => permissionGrantValues(input),
        catch: (cause) => storeError("grant_permission", cause),
      }).pipe(
        Effect.flatMap((values) =>
          database
            .insert(authPermissionGrant)
            .values(values)
            .onConflictDoUpdate({
              target: [
                authPermissionGrant.subjectType,
                authPermissionGrant.subjectId,
                authPermissionGrant.permissionId,
                authPermissionGrant.scopeType,
                authPermissionGrant.scopeIdPresent,
                authPermissionGrant.scopeId,
              ],
              set: {
                expiresAt: values.expiresAt,
                metadata: values.metadata,
                revokedAt: null,
              },
            })
        ),
        Effect.asVoid,
        Effect.mapError((cause) =>
          cause instanceof PermissionStoreError
            ? cause
            : storeError("grant_permission", cause)
        )
      ),
    revokePermission: (input) =>
      database
        .update(authPermissionGrant)
        .set({ revokedAt: Number(input.revokedAt ?? UnixMillis(Date.now())) })
        .where(
          and(
            eq(authPermissionGrant.subjectType, input.subject.type),
            eq(authPermissionGrant.subjectId, input.subject.id),
            eq(authPermissionGrant.permissionId, input.permission),
            scopePredicate(authPermissionGrant, input.scope)
          )
        )
        .pipe(
          Effect.asVoid,
          Effect.mapError((cause) => storeError("revoke_permission", cause))
        ),
    listPermissionGrants: (input: PermissionGrantListInput = {}) => {
      const at = Number(input.at ?? UnixMillis(Date.now()));
      return database
        .select()
        .from(authPermissionGrant)
        .where(
          and(
            input.subject === undefined
              ? undefined
              : and(
                  eq(authPermissionGrant.subjectType, input.subject.type),
                  eq(authPermissionGrant.subjectId, input.subject.id)
                ),
            input.permission === undefined
              ? undefined
              : eq(authPermissionGrant.permissionId, input.permission),
            input.scope === undefined
              ? undefined
              : scopePredicate(authPermissionGrant, input.scope),
            activityPredicate(
              authPermissionGrant,
              input.activity ?? "active",
              at
            )
          )
        )
        .orderBy(
          asc(authPermissionGrant.subjectType),
          asc(authPermissionGrant.subjectId),
          asc(authPermissionGrant.permissionId),
          asc(authPermissionGrant.scopeType),
          asc(authPermissionGrant.scopeIdPresent),
          asc(authPermissionGrant.scopeId)
        )
        .pipe(
          Effect.mapError((cause) =>
            storeError("list_permission_grants", cause)
          ),
          Effect.flatMap((rows) =>
            decodeRows(
              "list_permission_grants",
              rows,
              decodePermissionGrant,
              comparePermissionGrants
            )
          )
        );
    },
    grantRole: (input) =>
      Effect.try({
        try: () => roleGrantValues(input),
        catch: (cause) => storeError("grant_role", cause),
      }).pipe(
        Effect.flatMap((values) =>
          database
            .insert(authRoleGrant)
            .values(values)
            .onConflictDoUpdate({
              target: [
                authRoleGrant.subjectType,
                authRoleGrant.subjectId,
                authRoleGrant.roleId,
                authRoleGrant.scopeType,
                authRoleGrant.scopeIdPresent,
                authRoleGrant.scopeId,
              ],
              set: {
                expiresAt: values.expiresAt,
                metadata: values.metadata,
                revokedAt: null,
              },
            })
        ),
        Effect.asVoid,
        Effect.mapError((cause) =>
          cause instanceof PermissionStoreError
            ? cause
            : storeError("grant_role", cause)
        )
      ),
    revokeRole: (input) =>
      database
        .update(authRoleGrant)
        .set({ revokedAt: Number(input.revokedAt ?? UnixMillis(Date.now())) })
        .where(
          and(
            eq(authRoleGrant.subjectType, input.subject.type),
            eq(authRoleGrant.subjectId, input.subject.id),
            eq(authRoleGrant.roleId, input.role),
            scopePredicate(authRoleGrant, input.scope)
          )
        )
        .pipe(
          Effect.asVoid,
          Effect.mapError((cause) => storeError("revoke_role", cause))
        ),
    listRoleGrants: (input: RoleGrantListInput = {}) => {
      const at = Number(input.at ?? UnixMillis(Date.now()));
      return database
        .select()
        .from(authRoleGrant)
        .where(
          and(
            input.subject === undefined
              ? undefined
              : and(
                  eq(authRoleGrant.subjectType, input.subject.type),
                  eq(authRoleGrant.subjectId, input.subject.id)
                ),
            input.role === undefined
              ? undefined
              : eq(authRoleGrant.roleId, input.role),
            input.scope === undefined
              ? undefined
              : scopePredicate(authRoleGrant, input.scope),
            activityPredicate(authRoleGrant, input.activity ?? "active", at)
          )
        )
        .orderBy(
          asc(authRoleGrant.subjectType),
          asc(authRoleGrant.subjectId),
          asc(authRoleGrant.roleId),
          asc(authRoleGrant.scopeType),
          asc(authRoleGrant.scopeIdPresent),
          asc(authRoleGrant.scopeId)
        )
        .pipe(
          Effect.mapError((cause) => storeError("list_role_grants", cause)),
          Effect.flatMap((rows) =>
            decodeRows(
              "list_role_grants",
              rows,
              decodeRoleGrant,
              compareRoleGrants
            )
          )
        );
    },
    assignRolePermission: (input) =>
      database
        .insert(authRolePermission)
        .values({
          roleId: input.role,
          permissionId: input.permission,
          scopeTypePresent: input.scopeType === undefined ? 0 : 1,
          scopeType: input.scopeType ?? "",
        })
        .onConflictDoNothing()
        .pipe(
          Effect.asVoid,
          Effect.mapError((cause) =>
            storeError("assign_role_permission", cause)
          )
        ),
    removeRolePermission: (input) =>
      database
        .delete(authRolePermission)
        .where(
          and(
            eq(authRolePermission.roleId, input.role),
            eq(authRolePermission.permissionId, input.permission),
            eq(
              authRolePermission.scopeTypePresent,
              input.scopeType === undefined ? 0 : 1
            ),
            eq(authRolePermission.scopeType, input.scopeType ?? "")
          )
        )
        .pipe(
          Effect.asVoid,
          Effect.mapError((cause) =>
            storeError("remove_role_permission", cause)
          )
        ),
    listRolePermissions: (input = {}) =>
      database
        .select()
        .from(authRolePermission)
        .where(
          and(
            input.role === undefined
              ? undefined
              : eq(authRolePermission.roleId, input.role),
            input.permission === undefined
              ? undefined
              : eq(authRolePermission.permissionId, input.permission),
            input.scopeType === undefined
              ? undefined
              : and(
                  eq(
                    authRolePermission.scopeTypePresent,
                    input.scopeType === null ? 0 : 1
                  ),
                  input.scopeType === null
                    ? undefined
                    : eq(authRolePermission.scopeType, input.scopeType)
                )
          )
        )
        .orderBy(
          asc(authRolePermission.roleId),
          asc(authRolePermission.permissionId),
          asc(authRolePermission.scopeTypePresent),
          asc(authRolePermission.scopeType)
        )
        .pipe(
          Effect.mapError((cause) =>
            storeError("list_role_permissions", cause)
          ),
          Effect.flatMap((rows) =>
            decodeRows(
              "list_role_permissions",
              rows,
              decodeRolePermission,
              compareRolePermissions
            )
          )
        ),
    hasPermission: (input) => {
      const now = Date.now();
      const directPermission = exists(
        database
          .select({ value: sql`1` })
          .from(authPermissionGrant)
          .where(
            and(
              eq(authPermissionGrant.subjectType, input.subject.type),
              eq(authPermissionGrant.subjectId, input.subject.id),
              eq(authPermissionGrant.permissionId, input.permission),
              activityPredicate(authPermissionGrant, "active", now),
              inheritedScopePredicate(authPermissionGrant, input.scope)
            )
          )
      );
      const requestedScopeType = scopeValues(input.scope).scopeType;
      const rolePermission = exists(
        database
          .select({ value: sql`1` })
          .from(authRolePermission)
          .where(
            and(
              eq(authRolePermission.roleId, authRoleGrant.roleId),
              eq(authRolePermission.permissionId, input.permission),
              or(
                eq(authRolePermission.scopeTypePresent, 0),
                and(
                  eq(authRolePermission.scopeTypePresent, 1),
                  eq(authRolePermission.scopeType, requestedScopeType)
                )
              )
            )
          )
      );
      const roleDerivedPermission = exists(
        database
          .select({ value: sql`1` })
          .from(authRoleGrant)
          .where(
            and(
              eq(authRoleGrant.subjectType, input.subject.type),
              eq(authRoleGrant.subjectId, input.subject.id),
              activityPredicate(authRoleGrant, "active", now),
              inheritedScopePredicate(authRoleGrant, input.scope),
              rolePermission
            )
          )
      );
      return database
        .select({ value: sql`1` })
        .from(sql`(select 1)`)
        .where(or(directPermission, roleDerivedPermission))
        .limit(1)
        .pipe(
          Effect.map((rows) => rows.length === 1),
          Effect.mapError((cause) => storeError("has_permission", cause))
        );
    },
    hasRole: (input) =>
      database
        .select({ roleId: authRoleGrant.roleId })
        .from(authRoleGrant)
        .where(
          and(
            eq(authRoleGrant.subjectType, input.subject.type),
            eq(authRoleGrant.subjectId, input.subject.id),
            eq(authRoleGrant.roleId, input.role),
            activityPredicate(authRoleGrant, "active", Date.now()),
            inheritedScopePredicate(authRoleGrant, input.scope)
          )
        )
        .limit(1)
        .pipe(
          Effect.map((rows) => rows.length === 1),
          Effect.mapError((cause) => storeError("has_role", cause))
        ),
  });
};

/** Native Drizzle D1 implementation of effect-auth's permission store. */
export const PermissionStoreD1Layer = Layer.effect(
  PermissionStore,
  ControlPlaneDatabase.pipe(Effect.map(makePermissionStore))
);
