import {
  AuthOriginCheckMiddlewareLive,
  AuthSchemaErrorMiddlewareLive,
} from "@effect-auth/core/HttpApi";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { D1DevEmailStoreLive } from "../auth/dev-email-store";
import { AuthLive, AuthRuntimeConfig } from "../auth/live";
import { CurrentRequestAuthMiddlewareLive } from "../auth/session";
import { EffectAuthStorageLive } from "../auth/storage-live";
import { MailPermissionsLive } from "../authorization/live";
import { MailAuthorizationLive } from "../authorization/mail-authorization";
import { MailResourceResolverLive } from "../authorization/mail-resource-resolver-live";
import { ControlPlaneLive } from "../control-plane/database-live";
import {
  MailboxAdministrationConfig,
  MailboxAdministrationLive,
  MailboxAdministrationOwnerEmail,
  MailboxAdministrationRuntimeLive,
  MailboxRegistryLive,
} from "../control-plane/mailbox-administration-live";
import {
  MailboxDoNamespace,
  MailboxRepositoryDoLive,
} from "../mailboxes/do-client";
import { BackendHttpApi } from "./api";
import { BackendConfig, BackendResources } from "./backend-context";
import { BackendHealthLive } from "./backend-health";
import { DevEmailGroupLive } from "./dev-emails";
import { HealthGroupLive } from "./health";
import { MailboxGroupLive } from "./mailboxes";
import { HttpApiPlatformLive } from "./platform";

/** Builds all BackendHttpApi groups from Worker resources and deployment config. */
const BackendRoutesLive = Layer.unwrap(
  Effect.gen(function* () {
    const resources = yield* BackendResources;
    const backendConfig = yield* BackendConfig;
    const authRuntimeConfigLive = Layer.succeed(
      AuthRuntimeConfig,
      AuthRuntimeConfig.of({
        emailFrom: backendConfig.emailFrom,
        emailSender: resources.emailSender,
        isDevelopment: backendConfig.isDevelopment,
        publicOrigin: backendConfig.publicOrigin,
        rateLimitNamespace: resources.authRateLimit,
        secrets: backendConfig.secrets,
      })
    );
    const requestValidationLive = Layer.merge(
      AuthSchemaErrorMiddlewareLive,
      AuthOriginCheckMiddlewareLive({
        allowMissingOrigin: false,
        allowedOrigins: [backendConfig.publicOrigin],
      })
    );
    const authStorageLive = EffectAuthStorageLive;
    const authLive = AuthLive.pipe(
      Layer.provide(requestValidationLive),
      Layer.provide(authRuntimeConfigLive),
      Layer.provide(authStorageLive)
    );
    const currentRequestAuthLive = CurrentRequestAuthMiddlewareLive.pipe(
      Layer.provide(authLive)
    );
    const permissionsLive = MailPermissionsLive.pipe(
      Layer.provide(authStorageLive)
    );
    const mailboxRepositoryLive = MailboxRepositoryDoLive.pipe(
      Layer.provide(
        Layer.merge(
          MailboxRegistryLive,
          Layer.succeed(
            MailboxDoNamespace,
            MailboxDoNamespace.of(resources.mailboxDataPlane)
          )
        )
      )
    );
    const resourceResolverLive = MailResourceResolverLive.pipe(
      Layer.provide(mailboxRepositoryLive)
    );
    const mailAuthorizationLive = MailAuthorizationLive.pipe(
      Layer.provide(Layer.merge(permissionsLive, resourceResolverLive))
    );
    const mailboxDependenciesLive = Layer.mergeAll(
      MailboxAdministrationLive.pipe(
        Layer.provide(
          Layer.merge(
            Layer.succeed(
              MailboxAdministrationConfig,
              MailboxAdministrationConfig.of({
                ownerEmail: Schema.decodeUnknownSync(
                  MailboxAdministrationOwnerEmail
                )(backendConfig.mailboxOwnerEmail),
              })
            ),
            MailboxAdministrationRuntimeLive
          )
        )
      ),
      mailAuthorizationLive
    );
    const mailboxGroupLive = MailboxGroupLive.pipe(
      Layer.provide(mailboxDependenciesLive),
      Layer.provide(currentRequestAuthLive),
      Layer.provide(requestValidationLive)
    );
    const healthGroupLive = HealthGroupLive.pipe(
      Layer.provide(BackendHealthLive.pipe(Layer.provide(permissionsLive)))
    );
    const devEmailGroupLive = DevEmailGroupLive.pipe(
      Layer.provide(D1DevEmailStoreLive),
      Layer.provide(
        Layer.succeed(BackendConfig, BackendConfig.of(backendConfig))
      )
    );

    return HttpApiBuilder.layer(BackendHttpApi).pipe(
      Layer.provide(
        Layer.mergeAll(
          authLive,
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
