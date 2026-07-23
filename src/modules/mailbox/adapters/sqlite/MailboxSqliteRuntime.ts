import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

export interface MailboxRuntime {
  readonly now: () => number;
  readonly randomId: () => string;
}

/** Clock and identifier source captured by SQLite store layers. */
export const MailboxRuntime = Context.Service<MailboxRuntime>(
  "cloudflare-inbox/MailboxRuntime"
);

export const MailboxRuntimeSqliteLayer = Layer.succeed(
  MailboxRuntime,
  MailboxRuntime.of({
    now: Date.now,
    randomId: () => crypto.randomUUID(),
  })
);
