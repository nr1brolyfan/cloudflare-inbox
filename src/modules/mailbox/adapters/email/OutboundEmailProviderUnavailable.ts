import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  DeliveryProviderUnavailableError as ProviderUnavailableError,
  OutboundEmailProvider,
} from "#/modules/mailbox/ports/OutboundEmailProvider";

/** Explicit failure for runtimes where no outbound transport is configured. */
export const OutboundEmailProviderUnavailableLayer = Layer.succeed(
  OutboundEmailProvider,
  OutboundEmailProvider.of({
    send: () =>
      Effect.fail(
        new ProviderUnavailableError({
          cause: new Error("Outbound email provider is not configured"),
          message: "Outbound email provider is unavailable",
        })
      ),
  })
);
