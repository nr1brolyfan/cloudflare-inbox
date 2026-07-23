import * as Layer from "effect/Layer";

import { TrustedMailResourceResolverTransportLayer } from "#/modules/authorization/adapters/transport/TrustedMailResourceResolverTransport";
import { MailboxAuthorizationApplicationLayer } from "#/modules/authorization/application/MailboxAuthorization";

/** Mailbox authorization backed by effect-auth and trusted mailbox ancestry. */
export const MailboxAuthorizationLayer =
  MailboxAuthorizationApplicationLayer.pipe(
    Layer.provide(TrustedMailResourceResolverTransportLayer)
  );
