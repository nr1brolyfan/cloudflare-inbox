import type { Challenge } from "@effect-auth/core/Challenge";
import type { EmailOtpLogin } from "@effect-auth/core/EmailOtp";
import type { EmailVerificationFlow } from "@effect-auth/core/EmailVerification";
import type { MagicLinkLogin } from "@effect-auth/core/MagicLink";
import type { PasswordReset } from "@effect-auth/core/Password";
import {
  RecoveryCodeManagementLive,
  RecoveryCodesLive,
} from "@effect-auth/core/RecoveryCode";
import type { IdentityStore } from "@effect-auth/core/Storage";
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
import { RecoverySafeEmailInitiationEffectAuthLayer } from "#/modules/account-security/adapters/effect-auth/RecoverySafeEmailInitiationEffectAuth";
import { AccountRecoveryDeliveryEmailLayer } from "#/modules/account-security/adapters/email/AccountRecoveryDeliveryEmail";
import { ExternalRecoveryIdentityDeliveryEmailLayer } from "#/modules/account-security/adapters/email/ExternalRecoveryIdentityDeliveryEmail";
import { RequestSessionAuthenticatorEffectAuthLayer } from "#/modules/account-security/adapters/http/RequestSessionAuthentication";
import { PasskeyAuthentication } from "#/modules/account-security/application/PasskeyAuthentication";
import { PasswordResetEligibility } from "#/modules/account-security/application/PasswordResetEligibility";
import type { RecoverySafeIdentityPolicy } from "#/modules/account-security/ports/RecoverySafeIdentityPolicy";

type RecoverySafeRawEffectAuthServices =
  | Challenge
  | EmailOtpLogin
  | EmailVerificationFlow
  | MagicLinkLogin
  | PasswordReset;

export const makeRecoverySafeAccountSecurityEffectAuthLayer = <
  RawServices,
  RawError,
  RawRequirements,
  PolicyServices,
  PolicyError,
  PolicyRequirements,
  StorageServices,
  StorageError,
  StorageRequirements,
  EligibilityServices,
  EligibilityError,
  EligibilityRequirements,
>(layers: {
  readonly rawEffectAuth: Layer.Layer<
    RecoverySafeRawEffectAuthServices | RawServices,
    RawError,
    RawRequirements
  >;
  readonly recoverySafeIdentity: Layer.Layer<
    RecoverySafeIdentityPolicy | PolicyServices,
    PolicyError,
    PolicyRequirements
  >;
  readonly authStorage: Layer.Layer<
    IdentityStore | StorageServices,
    StorageError,
    StorageRequirements
  >;
  readonly passwordResetEligibility: Layer.Layer<
    PasswordResetEligibility | EligibilityServices,
    EligibilityError,
    EligibilityRequirements
  >;
}) => {
  const recoverySafeEmailInitiation =
    RecoverySafeEmailInitiationEffectAuthLayer.pipe(
      Layer.provide(layers.recoverySafeIdentity),
      Layer.provide(layers.authStorage),
      Layer.provide(layers.rawEffectAuth)
    );
  const existingPasswordReset = ExistingPasswordResetEffectAuthLayer.pipe(
    Layer.provide(layers.passwordResetEligibility),
    Layer.provide(layers.recoverySafeIdentity),
    Layer.provide(layers.rawEffectAuth)
  );

  return Layer.mergeAll(
    layers.rawEffectAuth,
    recoverySafeEmailInitiation,
    existingPasswordReset
  );
};

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
    const rawEffectAuthLayer = AccountSecurityEffectAuthLayer.pipe(
      Layer.provide(runtimeConfigLayer),
      Layer.provide(authStorageLayer),
      Layer.provide(devEmailStoreLayer)
    );
    const recoverySafeIdentityLayer = RecoverySafeIdentityD1Layer;
    const passkeyConfigLayer = PasskeyRuntimeConfigEffectAuthLayer.pipe(
      Layer.provide(runtimeConfigLayer)
    );
    const passkeyAuthenticationLayer = PasskeyAuthentication.layerNoDeps.pipe(
      Layer.provide(
        Layer.mergeAll(
          rawEffectAuthLayer,
          authStorageLayer,
          PasskeyAuthenticationIdentityD1Layer,
          passkeyConfigLayer,
          SensitiveOperationStepUpClockCloudflareLayer
        )
      )
    );
    const requestSessionAuthenticatorLayer =
      RequestSessionAuthenticatorEffectAuthLayer.pipe(
        Layer.provide(rawEffectAuthLayer)
      );
    const passwordResetEligibilityLayer =
      PasswordResetEligibility.layerNoDeps.pipe(
        Layer.provide(rawEffectAuthLayer),
        Layer.provide(authStorageLayer)
      );
    const effectAuthLayer = makeRecoverySafeAccountSecurityEffectAuthLayer({
      authStorage: authStorageLayer,
      passwordResetEligibility: passwordResetEligibilityLayer,
      rawEffectAuth: rawEffectAuthLayer,
      recoverySafeIdentity: recoverySafeIdentityLayer,
    });
    const recoveryIdentityLayer = ExternalRecoveryIdentityD1Layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          ExternalRecoveryIdentityChallengeEffectAuthLayer.pipe(
            Layer.provide(effectAuthLayer)
          ),
          ExternalRecoveryIdentityDeliveryEmailLayer.pipe(
            Layer.provide(runtimeConfigLayer),
            Layer.provide(devEmailStoreLayer)
          ),
          ExternalRecoveryIdentityRuntimeLayer,
          recoverySafeIdentityLayer,
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
          RecoveryCodesLive.pipe(Layer.provide(effectAuthLayer)),
          recoverySafeIdentityLayer,
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
      recoveryIdentityLayer,
      passkeyEnrollmentLayer,
      passkeyCredentialAdministrationLayer,
      recoveryCodeAdministrationLayer,
      accountRecoveryLayer
    );
  })
);
