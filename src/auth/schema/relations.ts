// Generated from @effect-auth/core@0.1.0-alpha.19.
// Do not edit manually; run `bun run generate:auth-schema`.

import { defineRelations } from "drizzle-orm";
import * as schema from "./modules/index.js";

// Drizzle relations are application-level only and do not create SQLite foreign keys.
export const relations = defineRelations(schema, (r) => ({
  authUserIdentity: {
    user: r.one.authUser({
      from: r.authUserIdentity.userId,
      to: r.authUser.id,
    }),
    replacedBy: r.one.authUserIdentity({
      from: r.authUserIdentity.replacedById,
      to: r.authUserIdentity.id,
    }),
  },
  authCredential: {
    user: r.one.authUser({
      from: r.authCredential.userId,
      to: r.authUser.id,
    }),
  },
  authSession: {
    user: r.one.authUser({
      from: r.authSession.userId,
      to: r.authUser.id,
    }),
  },
  authTotpFactor: {
    user: r.one.authUser({
      from: r.authTotpFactor.userId,
      to: r.authUser.id,
    }),
  },
  authRecoveryCode: {
    user: r.one.authUser({
      from: r.authRecoveryCode.userId,
      to: r.authUser.id,
    }),
  },
  authRefreshToken: {
    user: r.one.authUser({
      from: r.authRefreshToken.userId,
      to: r.authUser.id,
    }),
    replacedBy: r.one.authRefreshToken({
      from: r.authRefreshToken.replacedById,
      to: r.authRefreshToken.id,
    }),
  },
  authOauthAccount: {
    user: r.one.authUser({
      from: r.authOauthAccount.userId,
      to: r.authUser.id,
    }),
  },
  authPasskeyCredential: {
    user: r.one.authUser({
      from: r.authPasskeyCredential.userId,
      to: r.authUser.id,
    }),
  },
  authApiKey: {
    user: r.one.authUser({
      from: r.authApiKey.userId,
      to: r.authUser.id,
    }),
  },
  authAuditLog: {
    user: r.one.authUser({
      from: r.authAuditLog.userId,
      to: r.authUser.id,
    }),
    actorUser: r.one.authUser({
      from: r.authAuditLog.actorUserId,
      to: r.authUser.id,
    }),
  },
  authLoginApprovalReview: {
    user: r.one.authUser({
      from: r.authLoginApprovalReview.userId,
      to: r.authUser.id,
    }),
    challenge: r.one.authVerification({
      from: r.authLoginApprovalReview.approvalChallengeId,
      to: r.authVerification.id,
    }),
  },
  authLoginRiskHistory: {
    user: r.one.authUser({
      from: r.authLoginRiskHistory.userId,
      to: r.authUser.id,
    }),
  },
  authTrustedDevice: {
    user: r.one.authUser({
      from: r.authTrustedDevice.userId,
      to: r.authUser.id,
    }),
  },
  authSecurityTimeline: {
    user: r.one.authUser({
      from: r.authSecurityTimeline.userId,
      to: r.authUser.id,
    }),
  },
  authOauthConsent: {
    user: r.one.authUser({
      from: r.authOauthConsent.userId,
      to: r.authUser.id,
    }),
    client: r.one.authOauthClient({
      from: r.authOauthConsent.clientId,
      to: r.authOauthClient.id,
    }),
  },
  authOauthProviderTokenVault: {
    user: r.one.authUser({
      from: r.authOauthProviderTokenVault.userId,
      to: r.authUser.id,
    }),
    account: r.one.authOauthAccount({
      from: r.authOauthProviderTokenVault.accountId,
      to: r.authOauthAccount.id,
    }),
  },
  authOauthAuthorizationCode: {
    client: r.one.authOauthClient({
      from: r.authOauthAuthorizationCode.clientId,
      to: r.authOauthClient.id,
    }),
  },
  authOauthDeviceAuthorization: {
    client: r.one.authOauthClient({
      from: r.authOauthDeviceAuthorization.clientId,
      to: r.authOauthClient.id,
    }),
  },
  authOauthClientSecret: {
    client: r.one.authOauthClient({
      from: r.authOauthClientSecret.clientId,
      to: r.authOauthClient.id,
    }),
  },
  authOauthProviderModeToken: {
    client: r.one.authOauthClient({
      from: r.authOauthProviderModeToken.clientId,
      to: r.authOauthClient.id,
    }),
    replacedBy: r.one.authOauthProviderModeToken({
      from: r.authOauthProviderModeToken.replacedByTokenHash,
      to: r.authOauthProviderModeToken.tokenHash,
    }),
  },
  authPermissionGrant: {
    permission: r.one.authPermissionDefinition({
      from: r.authPermissionGrant.permissionId,
      to: r.authPermissionDefinition.id,
    }),
  },
  authRoleGrant: {
    role: r.one.authRoleDefinition({
      from: r.authRoleGrant.roleId,
      to: r.authRoleDefinition.id,
    }),
  },
  authRolePermission: {
    role: r.one.authRoleDefinition({
      from: r.authRolePermission.roleId,
      to: r.authRoleDefinition.id,
    }),
    permission: r.one.authPermissionDefinition({
      from: r.authRolePermission.permissionId,
      to: r.authPermissionDefinition.id,
    }),
  },
}));
