import { HttpApiMiddleware } from "effect/unstable/httpapi";

import type { RequestCorrelation } from "#/shared/RequestCorrelation";

export class BackendRequestContextMiddleware extends HttpApiMiddleware.Service<
  BackendRequestContextMiddleware,
  { provides: RequestCorrelation }
>()("cloudflare-inbox/BackendRequestContextMiddleware") {}
