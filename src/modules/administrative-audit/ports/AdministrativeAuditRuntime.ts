import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface AdministrativeAuditRuntimeShape {
  readonly digestSha256: (value: string) => Effect.Effect<string, unknown>;
}

export const AdministrativeAuditRuntime =
  Context.Service<AdministrativeAuditRuntimeShape>(
    "cloudflare-inbox/AdministrativeAuditRuntime"
  );
