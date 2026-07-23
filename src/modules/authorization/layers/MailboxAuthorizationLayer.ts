import * as Layer from "effect/Layer";

import { TrustedMailResourceResolverDurableObjectLayer } from "#/modules/authorization/adapters/durable-object/TrustedMailResourceResolverDurableObject";
import { MailboxAuthorizationApplicationLayer } from "#/modules/authorization/application/MailboxAuthorization";

/** Mailbox authorization backed by effect-auth and trusted MailboxDO ancestry. */
export const MailboxAuthorizationLayer =
  MailboxAuthorizationApplicationLayer.pipe(
    Layer.provide(TrustedMailResourceResolverDurableObjectLayer)
  );
