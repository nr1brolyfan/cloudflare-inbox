import * as Schema from "effect/Schema";

export const mailboxRealtimeLeaseMillis = 10 * 60_000;

export const MailboxChangeScope = Schema.Literals([
  "drafts",
  "messages",
  "navigation",
  "outbound",
  "threads",
  "contacts",
]);
export type MailboxChangeScope = Schema.Schema.Type<typeof MailboxChangeScope>;

export const MailboxChangeScopes = Schema.Array(MailboxChangeScope).pipe(
  Schema.check(Schema.isLengthBetween(1, 6))
);
export type MailboxChangeScopes = Schema.Schema.Type<
  typeof MailboxChangeScopes
>;

export const MailboxChangedEvent = Schema.Struct({
  _tag: Schema.Literal("MailboxChanged"),
  formatVersion: Schema.Literal(1),
  scopes: MailboxChangeScopes,
});
export type MailboxChangedEvent = Schema.Schema.Type<
  typeof MailboxChangedEvent
>;

export const mailboxChangedEvent = (
  scopes: ReadonlySet<MailboxChangeScope> | readonly MailboxChangeScope[]
): MailboxChangedEvent => {
  const normalized = [...new Set(scopes)];
  // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 target does not expose Array.toSorted.
  normalized.sort();
  return {
    _tag: "MailboxChanged",
    formatVersion: 1,
    scopes: normalized,
  };
};
