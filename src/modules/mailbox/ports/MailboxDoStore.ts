import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  MailboxResourceLookup,
  MailboxResourceLookupResult,
} from "#/modules/mailbox/domain/MailboxResource";

import type {
  DirectoryRpcRequest,
  MailDataRpcRequest,
} from "./MailboxDoProtocol";

export interface MailboxDoStoreService {
  readonly executeDirectory: (
    request: DirectoryRpcRequest
  ) => Effect.Effect<unknown, unknown>;
  readonly executeMailData: (
    request: MailDataRpcRequest
  ) => Effect.Effect<unknown, unknown>;
  readonly resolveMailResource: (
    lookup: MailboxResourceLookup
  ) => Effect.Effect<MailboxResourceLookupResult, unknown>;
}

/** Aggregate mailbox persistence capability consumed by the DO transport. */
export class MailboxDoStore extends Context.Service<
  MailboxDoStore,
  MailboxDoStoreService
>()("cloudflare-inbox/MailboxDoStore") {}
