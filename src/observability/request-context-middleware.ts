import { HttpApiMiddleware } from "effect/unstable/httpapi";

import type { BackendRequestContext } from "./request-context";

export class BackendRequestContextMiddleware extends HttpApiMiddleware.Service<
  BackendRequestContextMiddleware,
  { provides: BackendRequestContext }
>()("cloudflare-inbox/BackendRequestContextMiddleware") {}
