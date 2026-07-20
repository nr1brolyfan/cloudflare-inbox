export interface MailboxViewSelection {
  readonly folder?: string;
  readonly label?: string;
}

export interface MailboxMessageQueryState {
  readonly hasAttachment?: boolean;
  readonly query?: string;
  readonly read?: "read" | "unread";
  readonly starred?: boolean;
}

/** Builds one encoded inbox URL while preserving its folder or label context. */
export const mailboxViewHref = (
  selection: MailboxViewSelection,
  threadId?: string,
  messageId?: string,
  state: MailboxMessageQueryState = {}
) => {
  const query = new URLSearchParams();
  if (selection.folder !== undefined) {
    query.set("folder", selection.folder);
  }
  if (selection.label !== undefined) {
    query.set("label", selection.label);
  }
  if (threadId !== undefined) {
    query.set("thread", threadId);
  }
  if (messageId !== undefined) {
    query.set("message", messageId);
  }
  if (state.query !== undefined) {
    query.set("q", state.query);
  }
  if (state.read !== undefined) {
    query.set("read", state.read);
  }
  if (state.starred) {
    query.set("starred", "true");
  }
  if (state.hasAttachment) {
    query.set("attachment", "true");
  }
  return `/inbox?${query.toString()}`;
};
