import {
  AuthOriginCheckMiddlewareLive,
  AuthSchemaErrorMiddlewareLive,
} from "@effect-auth/core/HttpApi";
import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { D1DevEmailStoreLive } from "../auth/dev-email-store";
import { AuthLive, AuthRuntimeConfig } from "../auth/live";
import { CurrentRequestAuthMiddlewareLive } from "../auth/session";
import { EffectAuthStorageLive } from "../auth/storage-live";
import { MailPermissionsLive } from "../authorization/live";
import { MailAuthorizationLive } from "../authorization/mail-authorization";
import { MailResourceResolverLive } from "../authorization/mail-resource-resolver-live";
import { ControlPlaneDatabase } from "../control-plane/database";
import { ControlPlaneLive } from "../control-plane/database-live";
import { appMailbox } from "../control-plane/schema";
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
    const controlPlane = yield* ControlPlaneDatabase;
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
        Layer.succeed(
          MailboxRepositoryDoConfig,
          MailboxRepositoryDoConfig.of({
            mailboxExists: (mailboxId) =>
              controlPlane
                .select({ id: appMailbox.id })
                .from(appMailbox)
                .where(
                  and(
                    eq(appMailbox.id, mailboxId),
                    eq(appMailbox.status, "active")
                  )
                )
                .limit(1)
                .pipe(Effect.map((rows) => rows.length === 1)),
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
