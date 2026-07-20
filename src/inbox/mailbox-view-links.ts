export interface MailboxViewSelection {
  readonly folder?: string;
  readonly label?: string;
}

/** Builds one encoded inbox URL while preserving its folder or label context. */
export const mailboxViewHref = (
  selection: MailboxViewSelection,
  threadId?: string,
  messageId?: string
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
  return `/inbox?${query.toString()}`;
};
