import { HttpApiMiddleware } from "effect/unstable/httpapi";

import type { BackendRequestContext } from "#/shared/BackendRequestContext";

export class BackendRequestContextMiddleware extends HttpApiMiddleware.Service<
  BackendRequestContextMiddleware,
  { provides: BackendRequestContext }
>()("cloudflare-inbox/BackendRequestContextMiddleware") {}
