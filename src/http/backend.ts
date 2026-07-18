import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { makeD1DevEmailStoreLive } from "../auth/dev-email-store";
import { makeAuthLive } from "../auth/live";
import { makeMailPermissionsLive } from "../authorization/live";
import { MailAuthorizationLive } from "../authorization/mail-authorization";
import * as MailResources from "../authorization/resources";
import { makeMailboxAdministrationLive } from "../mailboxes/administration";
import { BackendAuthConfig, BackendResources } from "./backend-context";
import { BackendHealthLive } from "./backend-health";
import { makeDevEmailHttpLive } from "./dev-emails";
import * as Health from "./health";
import {
  MailboxGroupLive,
  MailboxHttpLive,
  makeMailboxHttpMiddlewareLive,
} from "./mailboxes";
import { HttpApiPlatformLive } from "./platform";

const MailResourceResolverUnavailableLive = Layer.succeed(
  MailResources.MailResourceResolver,
  MailResources.MailResourceResolver.of({
    resolveAttachment: (resource) =>
      Effect.fail(
        new MailResources.MailResourceResolveError({
          message: "Mail resource storage is not available",
          reason: "storage",
          resource,
        })
      ),
    resolveDraft: (resource) =>
      Effect.fail(
        new MailResources.MailResourceResolveError({
          message: "Mail resource storage is not available",
          reason: "storage",
          resource,
        })
      ),
    resolveFolder: (resource) =>
      Effect.fail(
        new MailResources.MailResourceResolveError({
          message: "Mail resource storage is not available",
          reason: "storage",
          resource,
        })
      ),
    resolveMessage: (resource) =>
      Effect.fail(
        new MailResources.MailResourceResolveError({
          message: "Mail resource storage is not available",
          reason: "storage",
          resource,
        })
      ),
    resolveRule: (resource) =>
      Effect.fail(
        new MailResources.MailResourceResolveError({
          message: "Mail resource storage is not available",
          reason: "storage",
          resource,
        })
      ),
  })
);

const BackendRoutesLive = Layer.unwrap(
  Effect.gen(function* () {
    const resources = yield* BackendResources;
    const authConfig = yield* BackendAuthConfig;
    const auth = makeAuthLive({
      database: resources.database,
      emailFrom: authConfig.emailFrom,
      emailSender: resources.emailSender,
      isDevelopment: authConfig.isDevelopment,
      devEmailDatabase: resources.controlPlane,
      publicOrigin: authConfig.publicOrigin,
      rateLimitNamespace: resources.authRateLimit,
      secrets: authConfig.secrets,
    });
    const permissionsLive = makeMailPermissionsLive(resources.database);
    const mailAuthorizationLive = MailAuthorizationLive.pipe(
      Layer.provide(
        Layer.merge(permissionsLive, MailResourceResolverUnavailableLive)
      )
    );
    const mailboxMiddlewareLive = makeMailboxHttpMiddlewareLive(
      authConfig.publicOrigin
    );
    const mailboxDependenciesLive = Layer.mergeAll(
      makeMailboxAdministrationLive(resources.database, {
        ownerEmail: authConfig.mailboxOwnerEmail,
      }),
      mailAuthorizationLive,
      auth.sessionLive,
      mailboxMiddlewareLive
    );
    const mailboxGroupLive = MailboxGroupLive.pipe(
      Layer.provide(mailboxDependenciesLive)
    );
    const mailboxHttpLive = MailboxHttpLive.pipe(
      Layer.provide(Layer.merge(mailboxGroupLive, mailboxMiddlewareLive))
    );
    const healthHttpLive = Health.HealthHttpLive.pipe(
      Layer.provide(BackendHealthLive.pipe(Layer.provide(permissionsLive)))
    );
    const devEmailHttpLive = authConfig.isDevelopment
      ? makeDevEmailHttpLive(makeD1DevEmailStoreLive(resources.controlPlane))
      : Layer.empty;

    return Layer.mergeAll(
      auth.httpApiLive,
      healthHttpLive,
      mailboxHttpLive,
      devEmailHttpLive
    );
  })
);

export const BackendHttpLive = BackendRoutesLive.pipe(
  Layer.provide(HttpApiPlatformLive)
);
