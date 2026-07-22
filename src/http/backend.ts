import { BotProtectionNoopLive } from "@effect-auth/core/AbuseProtection";
import {
  AuthHttpApiConfigLive,
  AuthOriginCheckMiddlewareLive,
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
  SessionHttpOperationsLive,
} from "@effect-auth/core/HttpApi";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { AiToolAuditD1Live } from "../ai/tool-audit";
import { AiToolExecutorMailInteractiveLive } from "../ai/tool-executor";
import { AiToolRunBudgetLive } from "../ai/tool-run-budget";
import {
  AdministrativeAuditLive,
  AdministrativeAuditRuntimeLive,
} from "../audit/administrative-audit-live";
import { ExistingPasswordResetLive } from "../auth/existing-password-reset";
import { ExternalRecoveryIdentityChallengeLive } from "../auth/external-recovery-identity-challenge-live";
import { ExternalRecoveryIdentityDeliveryLive } from "../auth/external-recovery-identity-delivery-live";
import { AuthServicesLive } from "../auth/live";
import { PasswordResetEligibilityLive } from "../auth/password-reset-eligibility";
import { AuthRuntimeConfig } from "../auth/runtime-config";
import {
  CurrentRequestAuthMiddlewareLive,
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
import { ControlPlaneLive } from "../control-plane/batch";
import { MailboxRegistryLive } from "../control-plane/database";
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
import { RecoverySafeIdentityPolicyLive } from "../control-plane/recovery-safe-identity-live";
import { MailboxInlineAttachmentReadingLive } from "../mailboxes/attachment-reading";
import { MailboxRepositoryDoLive } from "../mailboxes/do-client";
import { DraftAttachmentBlobStoreR2WithRuntimeLive } from "../mailboxes/draft-attachment-store-r2-live";
import { MailboxDraftAttachmentsLive } from "../mailboxes/draft-attachments";
import { MailboxDraftEditingLive } from "../mailboxes/draft-editing";
import { MailboxDraftReadingLive } from "../mailboxes/draft-reading";
import { InboundAttachmentBlobReaderR2WithRuntimeLive } from "../mailboxes/inbound-attachment-reader-r2-live";
import { InboundReplayAuthorizationLive } from "../mailboxes/inbound-replay-authorization-live";
import {
  InboundReplayLive,
  InboundReplayPreparerDoLive,
} from "../mailboxes/inbound-replay-do-live";
import { InboundWorkflowStarterLive } from "../mailboxes/inbound-workflow-starter-live";
import { MailboxMessageActionsLive } from "../mailboxes/message-actions";
import { MailboxMessageHtmlReadingLive } from "../mailboxes/message-html";
import { MailboxMessageReadingLive } from "../mailboxes/message-reading";
import {
  MailboxOutboundDeliveryReadingClockLive,
  MailboxOutboundDeliveryReadingLive,
} from "../mailboxes/outbound-delivery-reading";
import { MailboxOutboundSendingLive } from "../mailboxes/outbound-sending";
import { BackendHealthLive } from "../observability/backend-health-live";
import { BackendRequestContextMiddlewareLive } from "../observability/backend-request-live";
import { BackendHttpApi } from "./api";
import {
  PasswordEnrollmentUnavailableGroupLive,
  RestrictedEmailOtpGroupLive,
} from "./auth";
import {
  PasswordOnlyStepUpHttpOperationsLive,
  PasswordStepUpGroupLive,
} from "./auth-step-up";
import { DevEmailGroupLive } from "./dev-emails";
import { ExternalRecoveryIdentityGroupLive } from "./external-recovery-identities";
import { HealthGroupLive } from "./health";
import { MailboxGroupLive } from "./mailboxes";
import { HttpApiPlatformLive } from "./platform";

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
    const requestValidationLive = Layer.merge(
      AuthSchemaErrorMiddlewareLive,
      AuthOriginCheckMiddlewareLive(originPolicy)
    );
    const authStorageLive = EffectAuthStorageLive;
    const devEmailStoreLive = D1DevEmailStoreLive;
    const authServicesLive = AuthServicesLive.pipe(
      Layer.provide(authRuntimeConfigLive),
      Layer.provide(authStorageLive),
      Layer.provide(devEmailStoreLive)
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
      PasswordStepUpGroupLive
    ).pipe(
      Layer.provide(passwordHttpOperationsLive),
      Layer.provide(SessionHttpOperationsLive),
      Layer.provide(EmailVerificationHttpOperationsLive),
      Layer.provide(EmailOtpHttpOperationsLive),
      Layer.provide(MagicLinkHttpOperationsLive),
      Layer.provide(LoginApprovalHttpOperationsLive),
      Layer.provide(LoginNotificationHttpOperationsLive),
      Layer.provide(PasswordOnlyStepUpHttpOperationsLive),
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
    const mailboxRepositoryLive = MailboxRepositoryDoLive.pipe(
      Layer.provide(MailboxRegistryLive)
    );
    const resourceResolverLive = MailResourceResolverLive.pipe(
      Layer.provide(mailboxRepositoryLive)
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
      Layer.provide(Layer.merge(mailAuthorizationLive, mailboxRepositoryLive))
    );
    const mailboxMessageReadingLive = MailboxMessageReadingLive.pipe(
      Layer.provide(Layer.merge(mailAuthorizationLive, mailboxRepositoryLive))
    );
    const mailboxMessageActionsLive = MailboxMessageActionsLive.pipe(
      Layer.provide(Layer.merge(mailAuthorizationLive, mailboxRepositoryLive))
    );
    const mailboxDraftEditingLive = MailboxDraftEditingLive.pipe(
      Layer.provide(Layer.merge(mailAuthorizationLive, mailboxRepositoryLive))
    );
    const mailboxDraftReadingLive = MailboxDraftReadingLive.pipe(
      Layer.provide(Layer.merge(mailAuthorizationLive, mailboxRepositoryLive))
    );
    const mailboxOutboundSendingLive = MailboxOutboundSendingLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          mailAuthorizationLive,
          mailboxRepositoryLive,
          MailboxSenderIdentityLive
        )
      )
    );
    const mailboxOutboundDeliveryReadingLive =
      MailboxOutboundDeliveryReadingLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            mailAuthorizationLive,
            mailboxRepositoryLive,
            MailboxOutboundDeliveryReadingClockLive
          )
        )
      );
    const mailboxDraftAttachmentsLive = MailboxDraftAttachmentsLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          mailAuthorizationLive,
          mailboxRepositoryLive,
          DraftAttachmentBlobStoreR2WithRuntimeLive
        )
      )
    );
    const mailboxMessageHtmlLive = MailboxMessageHtmlReadingLive.pipe(
      Layer.provide(Layer.merge(mailAuthorizationLive, mailboxRepositoryLive))
    );
    const mailboxInlineAttachmentLive = MailboxInlineAttachmentReadingLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          mailAuthorizationLive,
          mailboxRepositoryLive,
          InboundAttachmentBlobReaderR2WithRuntimeLive
        )
      )
    );
    const inboundReplayLive = InboundReplayLive.pipe(
      Layer.provide(
        Layer.merge(
          InboundReplayPreparerDoLive.pipe(Layer.provide(MailboxRegistryLive)),
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

    return HttpApiBuilder.layer(BackendHttpApi).pipe(
      Layer.provide(
        Layer.mergeAll(
          authGroupHandlersLive,
          recoveryIdentityGroupLive,
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
