import type { AlchemyRateLimitDurableObjectNamespace } from "@effect-auth/core/AlchemyCloudflareRateLimitDurableObject";
import type * as Cloudflare from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { AuthHttpApiLiveOptions } from "../auth/live";

type ControlPlaneClient = Effect.Success<
  ReturnType<typeof Cloudflare.D1.QueryDatabase>
>;
type RawMessagesClient = Effect.Success<
  ReturnType<typeof Cloudflare.R2.ReadWriteBucket>
>;

export interface BackendResources {
  readonly authRateLimit: AlchemyRateLimitDurableObjectNamespace;
  readonly controlPlane: ControlPlaneClient;
  readonly database: AuthHttpApiLiveOptions["database"];
  readonly emailSender: AuthHttpApiLiveOptions["emailSender"];
  readonly rawMessages: RawMessagesClient;
}

export const BackendResources = Context.Service<BackendResources>(
  "cloudflare-inbox/BackendResources"
);

export interface BackendAuthConfig {
  readonly emailFrom: AuthHttpApiLiveOptions["emailFrom"];
  readonly isDevelopment: boolean;
  readonly mailboxOwnerEmail: string;
  readonly publicOrigin: string;
  readonly secrets: AuthHttpApiLiveOptions["secrets"];
}

export const BackendAuthConfig = Context.Service<BackendAuthConfig>(
  "cloudflare-inbox/BackendAuthConfig"
);
