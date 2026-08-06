import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AuthRuntimeConfig } from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";
import { MailboxNavigationD1Layer } from "#/modules/organization/adapters/d1/MailboxNavigationD1";

import {
  MailboxAdministrationD1Layer,
  mailboxAdministrationRuntimeLayer,
  OrganizationBootstrapD1Layer,
} from "./MailboxAdministrationD1Integration";
import {
  OrganizationAdministrationD1Layer,
  OrganizationAdministrationRuntimeLayer,
} from "./OrganizationAdministrationD1Integration";

const OrganizationServicesLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AuthRuntimeConfig;
    return Layer.merge(
      Layer.merge(
        MailboxAdministrationD1Layer,
        OrganizationBootstrapD1Layer
      ).pipe(
        Layer.provide(
          mailboxAdministrationRuntimeLayer(
            config.delivery._tag !== "development"
          )
        )
      ),
      OrganizationAdministrationD1Layer.pipe(
        Layer.provide(OrganizationAdministrationRuntimeLayer)
      )
    );
  })
);

/** Organization use cases backed by the existing control-plane D1 registry. */
export const OrganizationLayer = Layer.merge(
  OrganizationServicesLayer,
  MailboxNavigationD1Layer
);
