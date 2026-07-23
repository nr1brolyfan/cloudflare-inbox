import {
  RecoveryCodeManagementLive,
  RecoveryCodesLive,
} from "@effect-auth/core/RecoveryCode";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AuthRuntimeConfig } from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";
import { SensitiveOperationStepUpClockCloudflareLayer } from "#/modules/account-security/adapters/cloudflare/SensitiveOperationStepUpClockCloudflare";
import { AccountRecoveryD1Layer } from "#/modules/account-security/adapters/d1/AccountRecoveryD1";
import {
  DevEmailStoreD1Layer,
  EffectAuthStorageD1Layer,
} from "#/modules/account-security/adapters/d1/AccountSecurityStorageD1";
import {
  ExternalRecoveryIdentityD1Layer,
  ExternalRecoveryIdentityRuntimeLayer,
} from "#/modules/account-security/adapters/d1/ExternalRecoveryIdentityD1";
import { PasskeyAuthenticationIdentityD1Layer } from "#/modules/account-security/adapters/d1/PasskeyAuthenticationIdentityD1";
import {
  PasskeyCredentialAdministrationD1Layer,
  PasskeyCredentialAdministrationRuntimeLayer,
} from "#/modules/account-security/adapters/d1/PasskeyCredentialAdministrationD1";
import {
  PasskeyEnrollmentD1Layer,
  PasskeyEnrollmentRuntimeLayer,
} from "#/modules/account-security/adapters/d1/PasskeyEnrollmentD1";
import { RecoveryCodeAdministrationD1Layer } from "#/modules/account-security/adapters/d1/RecoveryCodeAdministrationD1";
import { RecoverySafeIdentityD1Layer } from "#/modules/account-security/adapters/d1/RecoverySafeIdentityD1";
import { AccountSecurityEffectAuthLayer } from "#/modules/account-security/adapters/effect-auth/AccountSecurityEffectAuth";
import { ExistingPasswordResetEffectAuthLayer } from "#/modules/account-security/adapters/effect-auth/ExistingPasswordResetEffectAuth";
import { ExternalRecoveryIdentityChallengeEffectAuthLayer } from "#/modules/account-security/adapters/effect-auth/ExternalRecoveryIdentityChallengeEffectAuth";
import { PasskeyRuntimeConfigEffectAuthLayer } from "#/modules/account-security/adapters/effect-auth/PasskeyConfigEffectAuth";
import { AccountRecoveryDeliveryEmailLayer } from "#/modules/account-security/adapters/email/AccountRecoveryDeliveryEmail";
import { ExternalRecoveryIdentityDeliveryEmailLayer } from "#/modules/account-security/adapters/email/ExternalRecoveryIdentityDeliveryEmail";
import { RequestSessionAuthenticatorEffectAuthLayer } from "#/modules/account-security/adapters/http/RequestSessionAuthentication";
import { PasskeyAuthentication } from "#/modules/account-security/application/PasskeyAuthentication";
import { PasswordResetEligibility } from "#/modules/account-security/application/PasswordResetEligibility";
import {
  AdministrativeAuditLayer,
  AdministrativeAuditRuntimeLayer,
} from "#/modules/administrative-audit/layers/AdministrativeAuditLayer";

/** Account-security use cases with concrete persistence and auth adapters selected. */
export const AccountSecurityLayer = Layer.unwrap(
  Effect.gen(function* () {
    const runtimeConfig = yield* AuthRuntimeConfig;
    const runtimeConfigLayer = Layer.succeed(
      AuthRuntimeConfig,
      AuthRuntimeConfig.of(runtimeConfig)
    );
    const authStorageLayer = EffectAuthStorageD1Layer;
    const devEmailStoreLayer = DevEmailStoreD1Layer;
    const effectAuthLayer = AccountSecurityEffectAuthLayer.pipe(
      Layer.provide(runtimeConfigLayer),
      Layer.provide(authStorageLayer),
      Layer.provide(devEmailStoreLayer)
    );
    const passkeyConfigLayer = PasskeyRuntimeConfigEffectAuthLayer.pipe(
      Layer.provide(runtimeConfigLayer)
    );
    const passkeyAuthenticationLayer = PasskeyAuthentication.layerNoDeps.pipe(
      Layer.provide(
        Layer.mergeAll(
          effectAuthLayer,
          authStorageLayer,
          PasskeyAuthenticationIdentityD1Layer,
          passkeyConfigLayer,
          SensitiveOperationStepUpClockCloudflareLayer
        )
      )
    );
    const requestSessionAuthenticatorLayer =
      RequestSessionAuthenticatorEffectAuthLayer.pipe(
        Layer.provide(effectAuthLayer)
      );
    const passwordResetEligibilityLayer =
      PasswordResetEligibility.layerNoDeps.pipe(
        Layer.provide(effectAuthLayer),
        Layer.provide(authStorageLayer)
      );
    const existingPasswordResetLayer =
      ExistingPasswordResetEffectAuthLayer.pipe(
        Layer.provide(passwordResetEligibilityLayer),
        Layer.provide(effectAuthLayer)
      );
    const administrativeAuditLayer = AdministrativeAuditLayer.pipe(
      Layer.provide(AdministrativeAuditRuntimeLayer)
    );
    const recoveryIdentityLayer = ExternalRecoveryIdentityD1Layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          administrativeAuditLayer,
          ExternalRecoveryIdentityChallengeEffectAuthLayer.pipe(
            Layer.provide(effectAuthLayer)
          ),
          ExternalRecoveryIdentityDeliveryEmailLayer.pipe(
            Layer.provide(runtimeConfigLayer),
            Layer.provide(devEmailStoreLayer)
          ),
          ExternalRecoveryIdentityRuntimeLayer,
          RecoverySafeIdentityD1Layer,
          SensitiveOperationStepUpClockCloudflareLayer
        )
      )
    );
    const passkeyEnrollmentLayer = PasskeyEnrollmentD1Layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          effectAuthLayer,
          RecoveryCodesLive.pipe(Layer.provide(effectAuthLayer)),
          PasskeyEnrollmentRuntimeLayer,
          passkeyConfigLayer,
          SensitiveOperationStepUpClockCloudflareLayer
        )
      )
    );
    const passkeyCredentialAdministrationLayer =
      PasskeyCredentialAdministrationD1Layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            effectAuthLayer,
            PasskeyCredentialAdministrationRuntimeLayer,
            SensitiveOperationStepUpClockCloudflareLayer
          )
        )
      );
    const recoveryCodeAdministrationLayer =
      RecoveryCodeAdministrationD1Layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            effectAuthLayer,
            RecoveryCodesLive.pipe(Layer.provide(effectAuthLayer)),
            SensitiveOperationStepUpClockCloudflareLayer
          )
        )
      );
    const recoveryCodeCoreLayer = RecoveryCodeManagementLive.pipe(
      Layer.provide(RecoveryCodesLive.pipe(Layer.provide(effectAuthLayer))),
      Layer.provide(effectAuthLayer),
      Layer.provide(authStorageLayer)
    );
    const accountRecoveryLayer = AccountRecoveryD1Layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          effectAuthLayer,
          authStorageLayer,
          recoveryCodeCoreLayer,
          RecoverySafeIdentityD1Layer,
          AccountRecoveryDeliveryEmailLayer.pipe(
            Layer.provide(runtimeConfigLayer),
            Layer.provide(devEmailStoreLayer)
          )
        )
      )
    );

    return Layer.mergeAll(
      authStorageLayer,
      devEmailStoreLayer,
      effectAuthLayer,
      passkeyConfigLayer,
      passkeyAuthenticationLayer,
      requestSessionAuthenticatorLayer,
      passwordResetEligibilityLayer,
      existingPasswordResetLayer,
      recoveryIdentityLayer,
      passkeyEnrollmentLayer,
      passkeyCredentialAdministrationLayer,
      recoveryCodeAdministrationLayer,
      accountRecoveryLayer
    );
  })
);
