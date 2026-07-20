export interface MailboxViewSelection {
  readonly folder?: string;
  readonly label?: string;
}

export interface MailboxMessageQueryState {
  readonly delivery?: string;
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
  if (state.delivery !== undefined) {
    query.set("delivery", state.delivery);
  }
  return `/inbox?${query.toString()}`;
};

export const mailboxMessageHtmlHref = (
  mailboxId: string,
  messageId: string,
  selection: MailboxViewSelection
) => {
  const query = new URLSearchParams();
  if (selection.folder !== undefined) {
    query.set("folder", selection.folder);
  } else if (selection.label !== undefined) {
    query.set("label", selection.label);
  }
  return `/api/mailboxes/${encodeURIComponent(mailboxId)}/messages/${encodeURIComponent(messageId)}/html?${query.toString()}`;
};
