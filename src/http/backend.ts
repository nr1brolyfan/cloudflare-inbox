import {
  AuthOriginCheckMiddlewareLive,
  AuthSchemaErrorMiddlewareLive,
} from "@effect-auth/core/HttpApi";
import { RuntimeContext } from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { D1DevEmailStoreLive, DevEmailDatabase } from "../auth/dev-email-store";
import { AuthLive, AuthRuntimeConfig } from "../auth/live";
import { CurrentRequestAuthMiddlewareLive } from "../auth/session";
import {
  MailPermissionDatabase,
  MailPermissionsLive,
} from "../authorization/live";
import { MailAuthorizationLive } from "../authorization/mail-authorization";
import { MailResourceResolverLive } from "../authorization/mail-resource-resolver-live";
import {
  MailboxAdministrationConfig,
  MailboxAdministrationLive,
} from "../mailboxes/administration";
import {
  MailboxRepositoryDoConfig,
  MailboxRepositoryDoLive,
} from "../mailboxes/mailbox-repository-do";
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
    const devEmailDatabaseLive = Layer.succeed(
      DevEmailDatabase,
      resources.controlPlane
    );
    const authRuntimeConfigLive = Layer.succeed(
      AuthRuntimeConfig,
      AuthRuntimeConfig.of({
        database: resources.database,
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
    const authLive = AuthLive.pipe(
      Layer.provide(requestValidationLive),
      Layer.provide(authRuntimeConfigLive),
      Layer.provide(devEmailDatabaseLive)
    );
    const currentRequestAuthLive = CurrentRequestAuthMiddlewareLive.pipe(
      Layer.provide(authLive)
    );
    const permissionsLive = MailPermissionsLive.pipe(
      Layer.provide(Layer.succeed(MailPermissionDatabase, resources.database))
    );
    const mailboxRepositoryLive = MailboxRepositoryDoLive.pipe(
      Layer.provide(
        Layer.succeed(
          MailboxRepositoryDoConfig,
          MailboxRepositoryDoConfig.of({
            mailboxExists: (mailboxId) =>
              resources.controlPlane
                .prepare(
                  "SELECT 1 AS present FROM app_mailbox WHERE id = ? AND status = 'active'"
                )
                .bind(mailboxId)
                .first<{ readonly present: number }>()
                .pipe(
                  Effect.map((row) => row?.present === 1),
                  Effect.provide(RuntimeContext.phantom)
                ),
            namespace: resources.mailboxDataPlane,
          })
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
          Layer.succeed(
            MailboxAdministrationConfig,
            MailboxAdministrationConfig.of({
              database: resources.database,
              ownerEmail: backendConfig.mailboxOwnerEmail,
            })
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
      Layer.provide(devEmailDatabaseLive),
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
  Layer.provide(HttpApiPlatformLive)
);
