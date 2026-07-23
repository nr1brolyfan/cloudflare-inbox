import * as Layer from "effect/Layer";

import { InboundMailboxResolverD1Layer } from "#/modules/address-routing/adapters/d1/InboundMailboxResolverD1";
import { MailboxSenderIdentityD1Layer } from "#/modules/address-routing/adapters/d1/MailboxSenderIdentityD1";

/** Address-routing use cases backed by the existing control-plane D1 schema. */
export const AddressRoutingLayer = Layer.merge(
  InboundMailboxResolverD1Layer,
  MailboxSenderIdentityD1Layer
);
