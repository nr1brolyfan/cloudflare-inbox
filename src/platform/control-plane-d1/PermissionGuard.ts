import type * as AuthPermission from "@effect-auth/core/Permission";
import { and, eq, exists, gt, isNull, or, sql } from "drizzle-orm";

import {
  authPermissionGrant,
  authRoleGrant,
  authRolePermission,
} from "../../auth/schema/modules/permissions";
import type { ControlPlaneDatabase } from "./ControlPlaneDatabase";
import { controlPlaneDatabaseNow } from "./RequestAuthGuard";

export const permissionPredicate = (
  database: ControlPlaneDatabase,
  principal: AuthPermission.PermissionSubject,
  permission: AuthPermission.PermissionId,
  scope: AuthPermission.PermissionScope
) => {
  const scopeIdPresent = scope.id === undefined ? 0 : 1;
  const scopeId = scope.id ?? "";
  const permissionGrantScope = or(
    and(
      eq(authPermissionGrant.scopeType, "global"),
      eq(authPermissionGrant.scopeIdPresent, 0)
    ),
    and(
      eq(authPermissionGrant.scopeType, scope.type),
      eq(authPermissionGrant.scopeIdPresent, scopeIdPresent),
      eq(authPermissionGrant.scopeId, scopeId)
    )
  );
  const roleGrantScope = or(
    and(
      eq(authRoleGrant.scopeType, "global"),
      eq(authRoleGrant.scopeIdPresent, 0)
    ),
    and(
      eq(authRoleGrant.scopeType, scope.type),
      eq(authRoleGrant.scopeIdPresent, scopeIdPresent),
      eq(authRoleGrant.scopeId, scopeId)
    )
  );
  const rolePermission = exists(
    database
      .select({ value: sql`1` })
      .from(authRolePermission)
      .where(
        and(
          eq(authRolePermission.roleId, authRoleGrant.roleId),
          eq(authRolePermission.permissionId, permission),
          or(
            eq(authRolePermission.scopeTypePresent, 0),
            and(
              eq(authRolePermission.scopeTypePresent, 1),
              eq(authRolePermission.scopeType, scope.type)
            )
          )
        )
      )
  );

  return or(
    exists(
      database
        .select({ value: sql`1` })
        .from(authPermissionGrant)
        .where(
          and(
            eq(authPermissionGrant.subjectType, principal.type),
            eq(authPermissionGrant.subjectId, principal.id),
            eq(authPermissionGrant.permissionId, permission),
            isNull(authPermissionGrant.revokedAt),
            or(
              isNull(authPermissionGrant.expiresAt),
              gt(authPermissionGrant.expiresAt, controlPlaneDatabaseNow)
            ),
            permissionGrantScope
          )
        )
    ),
    exists(
      database
        .select({ value: sql`1` })
        .from(authRoleGrant)
        .where(
          and(
            eq(authRoleGrant.subjectType, principal.type),
            eq(authRoleGrant.subjectId, principal.id),
            isNull(authRoleGrant.revokedAt),
            or(
              isNull(authRoleGrant.expiresAt),
              gt(authRoleGrant.expiresAt, controlPlaneDatabaseNow)
            ),
            roleGrantScope,
            rolePermission
          )
        )
    )
  );
};
