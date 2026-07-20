import { BotProtectionNoopLive } from "@effect-auth/core/AbuseProtection";
import {
  AuthHttpApiConfigLive,
  AuthOriginCheckMiddlewareLive,
  AuthSchemaErrorMiddlewareLive,
} from "@effect-auth/core/HttpApi";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { CoreAuthGroupHandlersLive } from "../auth/http-api";
import { AuthRuntimeConfig, AuthServicesLive } from "../auth/live";
import {
  CurrentRequestAuthMiddlewareLive,
  RequestSessionAuthenticatorLive,
} from "../auth/session";
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
  MailboxAdministrationLive,
  MailboxAdministrationRuntimeLive,
} from "../control-plane/mailbox-administration-live";
import { MailboxNavigationLive } from "../control-plane/mailbox-navigation-live";
import { MailboxInlineAttachmentReadingLive } from "../mailboxes/attachment-reading";
import { MailboxRepositoryDoLive } from "../mailboxes/do-client";
import { MailboxDraftEditingLive } from "../mailboxes/draft-editing";
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
import { BackendHealthLive } from "../observability/backend-health-live";
import { BackendHttpApi } from "./api";
import { DevEmailGroupLive } from "./dev-emails";
import { HealthGroupLive } from "./health";
import { MailboxGroupLive } from "./mailboxes";
import { HttpApiPlatformLive } from "./platform";

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
    const authGroupHandlersLive = CoreAuthGroupHandlersLive.pipe(
      Layer.provide(
        AuthHttpApiConfigLive({
          originCheck: originPolicy,
          requestMetadata: { trustProxyHeaders: true },
        })
      ),
      Layer.provide(requestValidationLive),
      Layer.provide(authServicesLive),
      Layer.provide(authStorageLive),
      Layer.provide(BotProtectionNoopLive)
    );
    const requestSessionAuthenticatorLive =
      RequestSessionAuthenticatorLive.pipe(Layer.provide(authServicesLive));
    const currentRequestAuthLive = CurrentRequestAuthMiddlewareLive.pipe(
      Layer.provide(requestSessionAuthenticatorLive)
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
        Layer.merge(MailboxAdministrationRuntimeLive, mailAuthorizationLive)
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
          mailboxMessageHtmlLive,
          mailboxInlineAttachmentLive,
          InboundReplayAuthorizationLive.pipe(
            Layer.provide(mailAuthorizationLive)
          ),
          inboundReplayLive
        )
      ),
      Layer.provide(currentRequestAuthLive),
      Layer.provide(requestValidationLive)
    );
    const healthGroupLive = HealthGroupLive.pipe(
      Layer.provide(BackendHealthLive.pipe(Layer.provide(permissionsLive)))
    );
    const devEmailGroupLive = DevEmailGroupLive.pipe(
      Layer.provide(devEmailStoreLive)
    );

    return HttpApiBuilder.layer(BackendHttpApi).pipe(
      Layer.provide(
        Layer.mergeAll(
          authGroupHandlersLive,
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
