import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

export interface MailboxDirectoryRuntime {
  readonly now: () => number;
  readonly randomId: () => string;
}

/** Explicit clock and identifier source used by directory transactions. */
export const MailboxDirectoryRuntime = Context.Service<MailboxDirectoryRuntime>(
  "cloudflare-inbox/MailboxDirectoryRuntime"
);

/** Production directory runtime backed by Worker platform globals. */
export const MailboxDirectoryRuntimeLive = Layer.succeed(
  MailboxDirectoryRuntime,
  MailboxDirectoryRuntime.of({
    now: Date.now,
    randomId: () => crypto.randomUUID(),
  })
);
