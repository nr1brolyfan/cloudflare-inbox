import type { AlchemyRateLimitDurableObjectNamespace } from "@effect-auth/core/AlchemyCloudflareRateLimitDurableObject";
import type * as Cloudflare from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { AuthRuntimeConfigShape } from "../auth/live";
import type { MailboxDONamespace } from "../mailboxes/mailbox-do";

type ControlPlaneClient = Effect.Success<
  ReturnType<typeof Cloudflare.D1.QueryDatabase>
>;
type RawMessagesClient = Effect.Success<
  ReturnType<typeof Cloudflare.R2.ReadWriteBucket>
>;

export interface BackendResources {
  readonly authRateLimit: AlchemyRateLimitDurableObjectNamespace;
  readonly controlPlane: ControlPlaneClient;
  readonly database: D1Database;
  readonly emailSender: AuthRuntimeConfigShape["emailSender"];
  readonly mailboxDataPlane: MailboxDONamespace;
  readonly rawMessages: RawMessagesClient;
}

/** Runtime Cloudflare handles acquired once when the Backend Worker starts. */
export const BackendResources = Context.Service<BackendResources>(
  "cloudflare-inbox/BackendResources"
);

export interface BackendConfig {
  readonly emailFrom: AuthRuntimeConfigShape["emailFrom"];
  readonly isDevelopment: boolean;
  readonly mailboxOwnerEmail: string;
  readonly publicOrigin: string;
  readonly secrets: AuthRuntimeConfigShape["secrets"];
}

/** Validated deployment configuration shared by auth and mailbox composition. */
export const BackendConfig = Context.Service<BackendConfig>(
  "cloudflare-inbox/BackendConfig"
);
