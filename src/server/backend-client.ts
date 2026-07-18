import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface BackendClientShape {
  readonly fetch: (
    operation: string,
    request: Request
  ) => Effect.Effect<Response>;
}

/** Website-side client for the private Backend service binding. */
export class BackendClient extends Context.Service<
  BackendClient,
  BackendClientShape
>()("cloudflare-inbox/BackendClient") {}
