import type { ValidatedSession } from "@effect-auth/core/Sessions";
import * as Context from "effect/Context";

export interface CurrentRequestAuthShape {
  readonly sessionSecretHash: string;
  readonly validated: ValidatedSession;
}

/** Token-bound authentication facts established once for the current request. */
export class CurrentRequestAuth extends Context.Service<
  CurrentRequestAuth,
  CurrentRequestAuthShape
>()("cloudflare-inbox/CurrentRequestAuth") {}
