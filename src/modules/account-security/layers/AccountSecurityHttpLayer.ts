import { BotProtectionNoopLive } from "@effect-auth/core/AbuseProtection";
import {
  AuthHttpApiConfigLive,
  AuthOriginCheckMiddlewareLive,
  AuthRequestMetadataMiddlewareLive,
  AuthSchemaErrorMiddlewareLive,
  CoreAuthLoginApprovalGroupLive,
  CoreAuthLoginNotificationGroupLive,
  CoreAuthSessionGroupLive,
  EmailOtpHttpOperationsLive,
  EmailVerificationHttpOperationsLive,
  LoginApprovalHttpOperationsLive,
  LoginNotificationHttpOperationsLive,
  MagicLinkHttpOperationsLive,
  PasswordHttpOperationsLive,
} from "@effect-auth/core/HttpApi";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AuthRuntimeConfig } from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";
import { SensitiveOperationStepUpClockCloudflareLayer } from "#/modules/account-security/adapters/cloudflare/SensitiveOperationStepUpClockCloudflare";
import { AccountRecoveryHttpHandlersLayer } from "#/modules/account-security/adapters/http/AccountRecoveryHttpHandlers";
import {
  PasswordEnrollmentUnavailableHttpHandlersLayer,
  RestrictedEmailOtpHttpHandlersLayer,
  RestrictedEmailVerificationHttpHandlersLayer,
  RestrictedMagicLinkHttpHandlersLayer,
} from "#/modules/account-security/adapters/http/AccountSecurityAuthHttpHandlers";
import { ApplicationSessionHttpOperationsLayer } from "#/modules/account-security/adapters/http/AuthSessionHttpOperations";
import {
  ApplicationStepUpHttpOperationsLayer,
  AuthStepUpHttpHandlersLayer,
} from "#/modules/account-security/adapters/http/AuthStepUpHttpOperations";
import { DevEmailHttpHandlersLayer } from "#/modules/account-security/adapters/http/DevEmailHttpHandlers";
import { ExternalRecoveryIdentityHttpHandlersLayer } from "#/modules/account-security/adapters/http/ExternalRecoveryIdentityHttpHandlers";
import { PasskeyAuthenticationHttpHandlersLayer } from "#/modules/account-security/adapters/http/PasskeyAuthenticationHttpHandlers";
import { PasskeyCredentialManagementHttpHandlersLayer } from "#/modules/account-security/adapters/http/PasskeyCredentialManagementHttpHandlers";
import {
  PasskeyEnrollmentHttpHandlersLayer,
  RecoveryPasskeyEnrollmentHttpHandlersLayer,
  RecoveryPasskeyEnrollmentReadbackHttpHandlersLayer,
} from "#/modules/account-security/adapters/http/PasskeyEnrollmentHttpHandlers";
import { RecoveryCodeManagementHttpHandlersLayer } from "#/modules/account-security/adapters/http/RecoveryCodeManagementHttpHandlers";
import {
  CurrentRequestAuthMiddlewareLayer,
  RecoveryRemediationRequestAuthMiddlewareLayer,
  SessionAuthenticationMiddlewareLayer,
} from "#/modules/account-security/adapters/http/RequestSessionAuthentication";
import { AccountSecurityLayer } from "#/modules/account-security/layers/AccountSecurityLayer";

/** Shared origin, metadata, schema-error, and authenticated-request middleware. */
export const AccountSecurityHttpMiddlewareLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AuthRuntimeConfig;
    const originPolicy = {
      allowMissingOrigin: false,
      allowedOrigins: [config.publicOrigin.origin],
    } as const;

    return Layer.mergeAll(
      AuthSchemaErrorMiddlewareLive,
      AuthOriginCheckMiddlewareLive(originPolicy),
      AuthRequestMetadataMiddlewareLive({ trustProxyHeaders: true }),
      CurrentRequestAuthMiddlewareLayer.pipe(
        Layer.provide(AccountSecurityLayer)
      ),
      SessionAuthenticationMiddlewareLayer.pipe(
        Layer.provide(AccountSecurityLayer)
      )
    );
  })
);

/** Account-security HTTP handlers closed over account-security adapters and policy. */
export const AccountSecurityHttpLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AuthRuntimeConfig;
    const originPolicy = {
      allowMissingOrigin: false,
      allowedOrigins: [config.publicOrigin.origin],
    } as const;
    const requestValidationLayer = AccountSecurityHttpMiddlewareLayer;
    const accountSecurityLayer = AccountSecurityLayer;
    const passwordHttpOperationsLayer = PasswordHttpOperationsLive.pipe(
      Layer.provide(accountSecurityLayer)
    );
    const coreHandlersLayer = Layer.mergeAll(
      PasswordEnrollmentUnavailableHttpHandlersLayer,
      CoreAuthSessionGroupLive,
      RestrictedEmailVerificationHttpHandlersLayer,
      RestrictedEmailOtpHttpHandlersLayer,
      RestrictedMagicLinkHttpHandlersLayer,
      CoreAuthLoginApprovalGroupLive,
      CoreAuthLoginNotificationGroupLive,
      AuthStepUpHttpHandlersLayer
    ).pipe(
      Layer.provide(passwordHttpOperationsLayer),
      Layer.provide(ApplicationSessionHttpOperationsLayer),
      Layer.provide(EmailVerificationHttpOperationsLive),
      Layer.provide(EmailOtpHttpOperationsLive),
      Layer.provide(MagicLinkHttpOperationsLive),
      Layer.provide(LoginApprovalHttpOperationsLive),
      Layer.provide(LoginNotificationHttpOperationsLive),
      Layer.provide(ApplicationStepUpHttpOperationsLayer),
      Layer.provide(accountSecurityLayer),
      Layer.provide(SensitiveOperationStepUpClockCloudflareLayer),
      Layer.provide(
        AuthHttpApiConfigLive({
          originCheck: originPolicy,
          requestMetadata: { trustProxyHeaders: true },
        })
      ),
      Layer.provide(requestValidationLayer),
      Layer.provide(accountSecurityLayer),
      Layer.provide(BotProtectionNoopLive)
    );
    const recoveryRequestAuthLayer =
      RecoveryRemediationRequestAuthMiddlewareLayer.pipe(
        Layer.provide(accountSecurityLayer)
      );
    const protectedHttpDependencies = AccountSecurityHttpMiddlewareLayer;

    return Layer.mergeAll(
      coreHandlersLayer,
      AccountRecoveryHttpHandlersLayer.pipe(
        Layer.provide(accountSecurityLayer),
        Layer.provide(requestValidationLayer)
      ),
      ExternalRecoveryIdentityHttpHandlersLayer.pipe(
        Layer.provide(accountSecurityLayer),
        Layer.provide(protectedHttpDependencies)
      ),
      PasskeyEnrollmentHttpHandlersLayer.pipe(
        Layer.provide(accountSecurityLayer),
        Layer.provide(protectedHttpDependencies)
      ),
      RecoveryPasskeyEnrollmentHttpHandlersLayer.pipe(
        Layer.provide(accountSecurityLayer),
        Layer.provide(recoveryRequestAuthLayer),
        Layer.provide(requestValidationLayer)
      ),
      RecoveryPasskeyEnrollmentReadbackHttpHandlersLayer.pipe(
        Layer.provide(accountSecurityLayer),
        Layer.provide(requestValidationLayer)
      ),
      PasskeyAuthenticationHttpHandlersLayer.pipe(
        Layer.provide(accountSecurityLayer),
        Layer.provide(requestValidationLayer)
      ),
      PasskeyCredentialManagementHttpHandlersLayer.pipe(
        Layer.provide(accountSecurityLayer),
        Layer.provide(protectedHttpDependencies)
      ),
      RecoveryCodeManagementHttpHandlersLayer.pipe(
        Layer.provide(accountSecurityLayer),
        Layer.provide(protectedHttpDependencies)
      ),
      DevEmailHttpHandlersLayer.pipe(Layer.provide(accountSecurityLayer))
    );
  })
);
