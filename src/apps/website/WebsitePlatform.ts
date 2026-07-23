import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { WebsiteEnv } from "../../../alchemy.run.ts";
import {
  backendRequestMethod,
  backendRequestRoute,
} from "../../platform/observability/BackendRequestCompletion";

const hasWebsiteBindings = (
  env: Cloudflare.Env
): env is Cloudflare.Env & WebsiteEnv =>
  "BACKEND" in env && "DEV_EMAIL_INBOX_ENABLED" in env;

interface WebsitePlatformShape {
  readonly devEmailInboxEnabled: boolean;
  readonly fetch: (operation: string, request: Request) => Promise<Response>;
}

const WebsitePlatform = Context.Service<WebsitePlatformShape>(
  "cloudflare-inbox/WebsitePlatform"
);

const WebsitePlatformBindingsLayer = Layer.effect(
  WebsitePlatform,
  Effect.promise(async () => {
    const Cloudflare = await import("cloudflare:workers");
    if (!hasWebsiteBindings(Cloudflare.env)) {
      throw new Error("Website Cloudflare bindings are unavailable");
    }
    const { env } = Cloudflare;

    return WebsitePlatform.of({
      devEmailInboxEnabled: String(env.DEV_EMAIL_INBOX_ENABLED) === "true",
      fetch: (operation, request) =>
        Cloudflare.tracing.enterSpan(operation, (span) => {
          if (span.isTraced) {
            const url = new URL(request.url);
            span.setAttribute(
              "http.request.method",
              backendRequestMethod(request.method)
            );
            span.setAttribute("http.route", backendRequestRoute(url.pathname));
          }

          return env.BACKEND.fetch(request);
        }),
    });
  })
);

export interface BackendClientShape {
  readonly fetch: (
    operation: string,
    request: Request
  ) => Effect.Effect<Response>;
}

/** Website-side client for the private Backend service binding. */
export const BackendClient = Context.Service<BackendClientShape>(
  "cloudflare-inbox/BackendClient"
);

/** Cloudflare implementation that traces every Website-to-Backend binding call. */
export const BackendClientLayer = Layer.effect(
  BackendClient,
  Effect.gen(function* () {
    const platform = yield* WebsitePlatform;
    return BackendClient.of({
      fetch: (operation, request) =>
        Effect.promise(() => platform.fetch(operation, request)),
    });
  })
);

export interface WebsiteConfigShape {
  readonly devEmailInboxEnabled: boolean;
}

/** Website feature configuration read from the Cloudflare environment. */
export const WebsiteConfig = Context.Service<WebsiteConfigShape>(
  "cloudflare-inbox/WebsiteConfig"
);

export const WebsiteConfigLayer = Layer.effect(
  WebsiteConfig,
  Effect.gen(function* () {
    const platform = yield* WebsitePlatform;
    return WebsiteConfig.of({
      devEmailInboxEnabled: platform.devEmailInboxEnabled,
    });
  })
);

/** Concrete Website platform services sharing one Cloudflare acquisition. */
export const WebsitePlatformLayer = Layer.merge(
  BackendClientLayer,
  WebsiteConfigLayer
).pipe(Layer.provide(WebsitePlatformBindingsLayer));
