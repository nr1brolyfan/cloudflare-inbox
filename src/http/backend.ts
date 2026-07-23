import { BotProtectionNoopLive } from "@effect-auth/core/AbuseProtection";
import {
  AuthHttpApiConfigLive,
  AuthOriginCheckMiddlewareLive,
  AuthRequestMetadataMiddlewareLive,
  AuthSchemaErrorMiddlewareLive,
  CoreAuthEmailVerificationGroupLive,
  CoreAuthLoginApprovalGroupLive,
  CoreAuthLoginNotificationGroupLive,
  CoreAuthMagicLinkGroupLive,
  CoreAuthSessionGroupLive,
  EmailOtpHttpOperationsLive,
  EmailVerificationHttpOperationsLive,
  LoginApprovalHttpOperationsLive,
  LoginNotificationHttpOperationsLive,
  MagicLinkHttpOperationsLive,
  PasswordHttpOperationsLive,
} from "@effect-auth/core/HttpApi";
import {
  RecoveryCodeManagementLive,
  RecoveryCodesLive,
} from "@effect-auth/core/RecoveryCode";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { MailboxDoClientLayer } from "#/modules/mailbox/adapters/durable-object/MailboxDoClient";
import {
  MailboxDirectoryRepositoryDoLayer,
  MailboxDraftRepositoryDoLayer,
  MailboxMessageRepositoryDoLayer,
  MailboxOutboundDeliveryRepositoryDoLayer,
  MailboxOutboundSendingRepositoryDoLayer,
  MailboxResourceRepositoryDoLayer,
} from "#/modules/mailbox/adapters/durable-object/MailboxRepositoryDo";
import { DraftAttachmentBlobStoreR2Layer } from "#/modules/mailbox/adapters/r2/DraftAttachmentBlobStoreR2";
import { MailboxOutboundDeliveryReadingClockSystemLayer } from "#/modules/mailbox/adapters/system/MailboxOutboundDeliveryReadingClockSystem";
import { MailboxDraftAttachments } from "#/modules/mailbox/application/MailboxDraftAttachments";
import { MailboxDraftEditing } from "#/modules/mailbox/application/MailboxDraftEditing";
import { MailboxDraftReading } from "#/modules/mailbox/application/MailboxDraftReading";
import { MailboxInlineAttachmentReading } from "#/modules/mailbox/application/MailboxInlineAttachmentReading";
import { MailboxMessageActions } from "#/modules/mailbox/application/MailboxMessageActions";
import { MailboxMessageHtmlReading } from "#/modules/mailbox/application/MailboxMessageHtmlReading";
import { MailboxMessageReading } from "#/modules/mailbox/application/MailboxMessageReading";
import { MailboxOutboundDeliveryReading } from "#/modules/mailbox/application/MailboxOutboundDeliveryReading";
import { MailboxOutboundSending } from "#/modules/mailbox/application/MailboxOutboundSending";
import { MailboxRegistryD1Layer } from "#/modules/organization/adapters/d1/MailboxRegistryD1";

import { AiToolAuditD1Live } from "../ai/tool-audit";
import { AiToolExecutorMailInteractiveLive } from "../ai/tool-executor";
import { AiToolRunBudgetLive } from "../ai/tool-run-budget";
import {
  AdministrativeAuditLive,
  AdministrativeAuditRuntimeLive,
} from "../audit/administrative-audit-live";
import { AccountRecoveryDeliveryLive } from "../auth/account-recovery-delivery-live";
import { ExistingPasswordResetLive } from "../auth/existing-password-reset";
import { ExternalRecoveryIdentityChallengeLive } from "../auth/external-recovery-identity-challenge-live";
import { ExternalRecoveryIdentityDeliveryLive } from "../auth/external-recovery-identity-delivery-live";
import { AuthServicesLive } from "../auth/live";
import { PasskeyAuthentication } from "../auth/passkey-authentication";
import { PasskeyRuntimeConfigLive } from "../auth/passkey-config";
import { PasswordResetEligibilityLive } from "../auth/password-reset-eligibility";
import { AuthRuntimeConfig } from "../auth/runtime-config";
import {
  CurrentRequestAuthMiddlewareLive,
  RecoveryRemediationRequestAuthMiddlewareLive,
  RequestSessionAuthenticatorLive,
} from "../auth/session";
import { SensitiveOperationStepUpClockLive } from "../auth/step-up-policy";
import {
  D1DevEmailStoreLive,
  EffectAuthStorageLive,
} from "../auth/storage-live";
import { MailAuthorizationLive } from "../authorization/mail-authorization";
import { MailResourceResolverLive } from "../authorization/mail-resource-resolver-live";
import { MailPermissionsLive } from "../authorization/permissions-live";
import { AccountRecoveryLive } from "../control-plane/account-recovery-live";
import { ControlPlaneLive } from "../control-plane/batch";
import {
  ExternalRecoveryIdentityManagementLive,
  ExternalRecoveryIdentityRuntimeLive,
} from "../control-plane/external-recovery-identity-live";
import {
  MailboxAdministrationLive,
  MailboxAdministrationRuntimeLive,
} from "../control-plane/mailbox-administration-live";
import { MailboxNavigationLive } from "../control-plane/mailbox-navigation-live";
import { MailboxSenderIdentityLive } from "../control-plane/mailbox-sender-identity-live";
import {
  PasskeyCredentialAdministrationLive,
  PasskeyCredentialAdministrationRuntimeLive,
} from "../control-plane/passkey-credential-administration-live";
import {
  PasskeyEnrollmentLive,
  PasskeyEnrollmentRuntimeLive,
} from "../control-plane/passkey-enrollment-live";
import { RecoveryCodeAdministrationLive } from "../control-plane/recovery-code-administration-live";
import { RecoverySafeIdentityPolicyLive } from "../control-plane/recovery-safe-identity-live";
import { InboundAttachmentBlobReaderR2WithRuntimeLive } from "../mailboxes/inbound-attachment-reader-r2-live";
import { InboundReplayAuthorizationLive } from "../mailboxes/inbound-replay-authorization-live";
import {
  InboundReplayLive,
  InboundReplayPreparerDoLive,
} from "../mailboxes/inbound-replay-do-live";
import { InboundWorkflowStarterLive } from "../mailboxes/inbound-workflow-starter-live";
import { BackendHealthLive } from "../observability/backend-health-live";
import { BackendRequestContextMiddlewareLive } from "../observability/backend-request-live";
import { AccountRecoveryApiLayer } from "./account-recovery";
import { BackendHttpApi } from "./api";
import {
  PasswordEnrollmentUnavailableGroupLive,
  RestrictedEmailOtpGroupLive,
} from "./auth";
import { ApplicationSessionHttpOperationsLayer } from "./auth-session";
import {
  ApplicationStepUpHttpOperationsLayer,
  StepUpApiLayer,
} from "./auth-step-up";
import { DevEmailGroupLive } from "./dev-emails";
import { ExternalRecoveryIdentityGroupLive } from "./external-recovery-identities";
import { HealthGroupLive } from "./health";
import { MailboxGroupLive } from "./mailboxes";
import { PasskeyAuthenticationApiLayer } from "./passkey-authentication";
import { PasskeyCredentialManagementGroupLive } from "./passkey-credential-management";
import {
  PasskeyEnrollmentGroupLive,
  RecoveryPasskeyEnrollmentApiLayer,
} from "./passkey-enrollment";
import { HttpApiPlatformLive } from "./platform";
import { RecoveryCodeManagementApiLayer } from "./recovery-code-management";

/** Acquire once per interactive request/run so its atomic budget is never process-global. */
export const BackendAiInteractiveToolkitLive =
  AiToolExecutorMailInteractiveLive.pipe(
    Layer.provide(AiToolRunBudgetLive),
    Layer.provide(AiToolAuditD1Live)
  );

/** Builds all BackendHttpApi groups from Worker resources and deployment config. */
const BackendRoutesLive = Layer.unwrap(
  Effect.gen(function* () {
    const authRuntimeConfig = yield* AuthRuntimeConfig;
    const authRuntimeConfigLive = Layer.succeed(
      AuthRuntimeConfig,
      AuthRuntimeConfig.of(authRuntimeConfig)
    );
    const originPolicy = {
      allowMissingOrigin: false,
      allowedOrigins: [authRuntimeConfig.publicOrigin.origin],
    } as const;
    const requestValidationLive = Layer.mergeAll(
      AuthSchemaErrorMiddlewareLive,
      AuthOriginCheckMiddlewareLive(originPolicy),
      AuthRequestMetadataMiddlewareLive({ trustProxyHeaders: true })
    );
    const authStorageLive = EffectAuthStorageLive;
    const devEmailStoreLive = D1DevEmailStoreLive;
    const authServicesLive = AuthServicesLive.pipe(
      Layer.provide(authRuntimeConfigLive),
      Layer.provide(authStorageLive),
      Layer.provide(devEmailStoreLive)
    );
    const passkeyAuthenticationLive = PasskeyAuthentication.layerNoDeps.pipe(
      Layer.provide(
        Layer.mergeAll(
          authServicesLive,
          authStorageLive,
          PasskeyRuntimeConfigLive.pipe(Layer.provide(authRuntimeConfigLive)),
          SensitiveOperationStepUpClockLive
        )
      )
    );
    const requestSessionAuthenticatorLive =
      RequestSessionAuthenticatorLive.pipe(Layer.provide(authServicesLive));
    const passwordResetEligibilityLive = PasswordResetEligibilityLive.pipe(
      Layer.provide(authServicesLive),
      Layer.provide(authStorageLive)
    );
    const existingPasswordResetLive = ExistingPasswordResetLive.pipe(
      Layer.provide(passwordResetEligibilityLive),
      Layer.provide(authServicesLive)
    );
    const passwordHttpOperationsLive = PasswordHttpOperationsLive.pipe(
      Layer.provide(existingPasswordResetLive),
      Layer.provide(authServicesLive)
    );
    const authGroupHandlersLive = Layer.mergeAll(
      PasswordEnrollmentUnavailableGroupLive,
      CoreAuthSessionGroupLive,
      CoreAuthEmailVerificationGroupLive,
      RestrictedEmailOtpGroupLive,
      CoreAuthMagicLinkGroupLive,
      CoreAuthLoginApprovalGroupLive,
      CoreAuthLoginNotificationGroupLive,
      StepUpApiLayer
    ).pipe(
      Layer.provide(passwordHttpOperationsLive),
      Layer.provide(ApplicationSessionHttpOperationsLayer),
      Layer.provide(EmailVerificationHttpOperationsLive),
      Layer.provide(EmailOtpHttpOperationsLive),
      Layer.provide(MagicLinkHttpOperationsLive),
      Layer.provide(LoginApprovalHttpOperationsLive),
      Layer.provide(LoginNotificationHttpOperationsLive),
      Layer.provide(ApplicationStepUpHttpOperationsLayer),
      Layer.provide(passwordResetEligibilityLive),
      Layer.provide(SensitiveOperationStepUpClockLive),
      Layer.provide(
        AuthHttpApiConfigLive({
          originCheck: originPolicy,
          requestMetadata: { trustProxyHeaders: true },
        })
      ),
      Layer.provide(requestValidationLive),
      Layer.provide(authServicesLive),
      Layer.provide(authStorageLive),
      Layer.provide(passkeyAuthenticationLive),
      Layer.provide(requestSessionAuthenticatorLive),
      Layer.provide(BotProtectionNoopLive)
    );
    const currentRequestAuthLive = CurrentRequestAuthMiddlewareLive.pipe(
      Layer.provide(requestSessionAuthenticatorLive)
    );
    const administrativeAuditLive = AdministrativeAuditLive.pipe(
      Layer.provide(AdministrativeAuditRuntimeLive)
    );
    const permissionsLive = MailPermissionsLive.pipe(
      Layer.provide(authStorageLive)
    );
    const mailboxDoClientLayer = MailboxDoClientLayer.pipe(
      Layer.provide(MailboxRegistryD1Layer)
    );
    const mailboxMessageRepositoryDoLayer =
      MailboxMessageRepositoryDoLayer.pipe(Layer.provide(mailboxDoClientLayer));
    const mailboxDirectoryRepositoryDoLayer =
      MailboxDirectoryRepositoryDoLayer.pipe(
        Layer.provide(mailboxDoClientLayer)
      );
    const mailboxDraftRepositoryDoLayer = MailboxDraftRepositoryDoLayer.pipe(
      Layer.provide(mailboxDoClientLayer)
    );
    const mailboxOutboundDeliveryRepositoryDoLayer =
      MailboxOutboundDeliveryRepositoryDoLayer.pipe(
        Layer.provide(mailboxDoClientLayer)
      );
    const mailboxOutboundSendingRepositoryDoLayer =
      MailboxOutboundSendingRepositoryDoLayer.pipe(
        Layer.provide(mailboxDoClientLayer)
      );
    const mailboxResourceRepositoryDoLayer =
      MailboxResourceRepositoryDoLayer.pipe(
        Layer.provide(mailboxDoClientLayer)
      );
    const resourceResolverLive = MailResourceResolverLive.pipe(
      Layer.provide(mailboxResourceRepositoryDoLayer)
    );
    const mailAuthorizationLive = MailAuthorizationLive.pipe(
      Layer.provide(Layer.merge(permissionsLive, resourceResolverLive))
    );
    const mailboxAdministrationLive = MailboxAdministrationLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          administrativeAuditLive,
          MailboxAdministrationRuntimeLive,
          mailAuthorizationLive,
          SensitiveOperationStepUpClockLive
        )
      )
    );
    const mailboxNavigationLive = MailboxNavigationLive.pipe(
      Layer.provide(
        Layer.merge(mailAuthorizationLive, mailboxDirectoryRepositoryDoLayer)
      )
    );
    const mailboxMessageReadingLive = MailboxMessageReading.layerNoDeps.pipe(
      Layer.provide(
        Layer.merge(mailAuthorizationLive, mailboxMessageRepositoryDoLayer)
      )
    );
    const mailboxMessageActionsLive = MailboxMessageActions.layerNoDeps.pipe(
      Layer.provide(
        Layer.mergeAll(
          mailAuthorizationLive,
          mailboxDirectoryRepositoryDoLayer,
          mailboxMessageRepositoryDoLayer
        )
      )
    );
    const mailboxDraftEditingLive = MailboxDraftEditing.layerNoDeps.pipe(
      Layer.provide(
        Layer.merge(mailAuthorizationLive, mailboxDraftRepositoryDoLayer)
      )
    );
    const mailboxDraftReadingLive = MailboxDraftReading.layerNoDeps.pipe(
      Layer.provide(
        Layer.merge(mailAuthorizationLive, mailboxDraftRepositoryDoLayer)
      )
    );
    const mailboxOutboundSendingLive = MailboxOutboundSending.layerNoDeps.pipe(
      Layer.provide(
        Layer.mergeAll(
          mailAuthorizationLive,
          mailboxOutboundSendingRepositoryDoLayer,
          MailboxSenderIdentityLive
        )
      )
    );
    const mailboxOutboundDeliveryReadingLive =
      MailboxOutboundDeliveryReading.layerNoDeps.pipe(
        Layer.provide(
          Layer.mergeAll(
            mailAuthorizationLive,
            mailboxOutboundDeliveryRepositoryDoLayer,
            MailboxOutboundDeliveryReadingClockSystemLayer
          )
        )
      );
    const mailboxDraftAttachmentsLive =
      MailboxDraftAttachments.layerNoDeps.pipe(
        Layer.provide(
          Layer.mergeAll(
            mailAuthorizationLive,
            mailboxDraftRepositoryDoLayer,
            DraftAttachmentBlobStoreR2Layer
          )
        )
      );
    const mailboxMessageHtmlLive = MailboxMessageHtmlReading.layerNoDeps.pipe(
      Layer.provide(
        Layer.merge(mailAuthorizationLive, mailboxMessageRepositoryDoLayer)
      )
    );
    const mailboxInlineAttachmentLive =
      MailboxInlineAttachmentReading.layerNoDeps.pipe(
        Layer.provide(
          Layer.mergeAll(
            mailAuthorizationLive,
            mailboxMessageRepositoryDoLayer,
            InboundAttachmentBlobReaderR2WithRuntimeLive
          )
        )
      );
    const inboundReplayLive = InboundReplayLive.pipe(
      Layer.provide(
        Layer.merge(
          InboundReplayPreparerDoLive.pipe(
            Layer.provide(MailboxRegistryD1Layer)
          ),
          InboundWorkflowStarterLive
        )
      )
    );
    const mailboxGroupLive = MailboxGroupLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          mailboxAdministrationLive,
          mailboxNavigationLive,
          mailboxMessageReadingLive,
          mailboxMessageActionsLive,
          mailboxDraftEditingLive,
          mailboxDraftReadingLive,
          mailboxOutboundDeliveryReadingLive,
          mailboxOutboundSendingLive,
          mailboxDraftAttachmentsLive,
          mailboxMessageHtmlLive,
          mailboxInlineAttachmentLive,
          InboundReplayAuthorizationLive.pipe(
            Layer.provide(mailAuthorizationLive)
          ),
          inboundReplayLive
        )
      ),
      Layer.provide(currentRequestAuthLive),
      Layer.provide(BackendRequestContextMiddlewareLive),
      Layer.provide(requestValidationLive)
    );
    const healthGroupLive = HealthGroupLive.pipe(
      Layer.provide(BackendHealthLive.pipe(Layer.provide(permissionsLive)))
    );
    const devEmailGroupLive = DevEmailGroupLive.pipe(
      Layer.provide(devEmailStoreLive)
    );
    const recoveryIdentityManagementLive =
      ExternalRecoveryIdentityManagementLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            administrativeAuditLive,
            ExternalRecoveryIdentityChallengeLive.pipe(
              Layer.provide(authServicesLive)
            ),
            ExternalRecoveryIdentityDeliveryLive.pipe(
              Layer.provide(authRuntimeConfigLive),
              Layer.provide(devEmailStoreLive)
            ),
            ExternalRecoveryIdentityRuntimeLive,
            RecoverySafeIdentityPolicyLive,
            SensitiveOperationStepUpClockLive
          )
        )
      );
    const recoveryIdentityGroupLive = ExternalRecoveryIdentityGroupLive.pipe(
      Layer.provide(recoveryIdentityManagementLive),
      Layer.provide(currentRequestAuthLive),
      Layer.provide(BackendRequestContextMiddlewareLive),
      Layer.provide(requestValidationLive)
    );
    const passkeyEnrollmentLive = PasskeyEnrollmentLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          authServicesLive,
          RecoveryCodesLive.pipe(Layer.provide(authServicesLive)),
          PasskeyEnrollmentRuntimeLive,
          PasskeyRuntimeConfigLive.pipe(Layer.provide(authRuntimeConfigLive)),
          SensitiveOperationStepUpClockLive
        )
      )
    );
    const passkeyEnrollmentGroupLive = PasskeyEnrollmentGroupLive.pipe(
      Layer.provide(passkeyEnrollmentLive),
      Layer.provide(currentRequestAuthLive),
      Layer.provide(BackendRequestContextMiddlewareLive),
      Layer.provide(requestValidationLive)
    );
    const recoveryRequestAuthLive =
      RecoveryRemediationRequestAuthMiddlewareLive.pipe(
        Layer.provide(requestSessionAuthenticatorLive)
      );
    const recoveryPasskeyEnrollmentApiLayer =
      RecoveryPasskeyEnrollmentApiLayer.pipe(
        Layer.provide(passkeyEnrollmentLive),
        Layer.provide(recoveryRequestAuthLive),
        Layer.provide(BackendRequestContextMiddlewareLive),
        Layer.provide(requestValidationLive),
        Layer.provide(authServicesLive)
      );
    const passkeyAuthenticationApiLayer = PasskeyAuthenticationApiLayer.pipe(
      Layer.provide(passkeyAuthenticationLive),
      Layer.provide(BackendRequestContextMiddlewareLive),
      Layer.provide(requestValidationLive),
      Layer.provide(authServicesLive)
    );
    const passkeyCredentialAdministrationLive =
      PasskeyCredentialAdministrationLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            authServicesLive,
            PasskeyCredentialAdministrationRuntimeLive,
            SensitiveOperationStepUpClockLive
          )
        )
      );
    const passkeyCredentialManagementGroupLive =
      PasskeyCredentialManagementGroupLive.pipe(
        Layer.provide(passkeyCredentialAdministrationLive),
        Layer.provide(currentRequestAuthLive),
        Layer.provide(BackendRequestContextMiddlewareLive),
        Layer.provide(requestValidationLive)
      );
    const recoveryCodeAdministrationLive = RecoveryCodeAdministrationLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          authServicesLive,
          RecoveryCodesLive.pipe(Layer.provide(authServicesLive)),
          SensitiveOperationStepUpClockLive
        )
      )
    );
    const recoveryCodeManagementApiLayer = RecoveryCodeManagementApiLayer.pipe(
      Layer.provide(recoveryCodeAdministrationLive),
      Layer.provide(currentRequestAuthLive),
      Layer.provide(BackendRequestContextMiddlewareLive),
      Layer.provide(requestValidationLive)
    );
    const recoveryCodeCoreLive = RecoveryCodeManagementLive.pipe(
      Layer.provide(RecoveryCodesLive.pipe(Layer.provide(authServicesLive))),
      Layer.provide(authServicesLive),
      Layer.provide(authStorageLive)
    );
    const accountRecoveryLive = AccountRecoveryLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          authServicesLive,
          authStorageLive,
          recoveryCodeCoreLive,
          RecoverySafeIdentityPolicyLive,
          AccountRecoveryDeliveryLive.pipe(
            Layer.provide(authRuntimeConfigLive),
            Layer.provide(devEmailStoreLive)
          )
        )
      )
    );
    const accountRecoveryApiLayer = AccountRecoveryApiLayer.pipe(
      Layer.provide(accountRecoveryLive),
      Layer.provide(BackendRequestContextMiddlewareLive),
      Layer.provide(requestValidationLive),
      Layer.provide(authServicesLive)
    );

    return HttpApiBuilder.layer(BackendHttpApi).pipe(
      Layer.provide(
        Layer.mergeAll(
          authGroupHandlersLive,
          accountRecoveryApiLayer,
          recoveryIdentityGroupLive,
          passkeyEnrollmentGroupLive,
          recoveryPasskeyEnrollmentApiLayer,
          passkeyAuthenticationApiLayer,
          passkeyCredentialManagementGroupLive,
          recoveryCodeManagementApiLayer,
          healthGroupLive,
          mailboxGroupLive,
          devEmailGroupLive
        )
      )
    );
  })
);

/** Complete private Backend HTTP router, including platform response support. */
export const BackendHttpLive = BackendRoutesLive.pipe(
  Layer.provide(ControlPlaneLive),
  Layer.provide(HttpApiPlatformLive)
);
