import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { DevEmailRecord } from "../http/dev-email-contract";
import {
  DevEmailClearedSchema,
  DevEmailListSchema,
} from "../http/dev-email-contract";
import { BackendClient, WebsiteConfig } from "./website-platform";

export type DevEmailInboxResult =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly messages: readonly DevEmailRecord[] };

export interface DevEmailOperationsShape {
  readonly clear: (
    incoming: Request
  ) => Effect.Effect<{ readonly enabled: boolean }>;
  readonly list: (incoming: Request) => Effect.Effect<DevEmailInboxResult>;
  readonly status: Effect.Effect<{ readonly enabled: boolean }>;
}

/** Development-inbox use cases, including the deployment feature gate. */
export const DevEmailOperations = Context.Service<DevEmailOperationsShape>(
  "cloudflare-inbox/DevEmailOperations"
);

export const DevEmailOperationsLive = Layer.effect(
  DevEmailOperations,
  Effect.gen(function* () {
    const backend = yield* BackendClient;
    const config = yield* WebsiteConfig;
    const requestBackend = (incoming: Request, method: "DELETE" | "GET") =>
      Effect.gen(function* () {
        const url = new URL("/api/dev-emails", incoming.url);
        const response = yield* backend.fetch(
          "website.dev_email.backend",
          new Request(url, { method })
        );

        if (!response.ok) {
          return yield* Effect.die(
            new Error("Development email inbox is unavailable")
          );
        }

        return response;
      });

    return DevEmailOperations.of({
      clear: (incoming) =>
        config.devEmailInboxEnabled
          ? requestBackend(incoming, "DELETE").pipe(
              Effect.flatMap((response) =>
                Effect.tryPromise(() => response.json())
              ),
              Effect.flatMap(Schema.decodeUnknownEffect(DevEmailClearedSchema)),
              Effect.orDie,
              Effect.as({ enabled: true as const })
            )
          : Effect.succeed({ enabled: false as const }),
      list: (incoming) =>
        config.devEmailInboxEnabled
          ? requestBackend(incoming, "GET").pipe(
              Effect.flatMap((response) =>
                Effect.promise(() => response.json())
              ),
              Effect.flatMap(Schema.decodeUnknownEffect(DevEmailListSchema)),
              Effect.orDie,
              Effect.map((body) => ({
                enabled: true as const,
                messages: body.messages,
              }))
            )
          : Effect.succeed({ enabled: false as const }),
      status: Effect.succeed({ enabled: config.devEmailInboxEnabled }),
    });
  })
);
