import {
  decodeMailboxSearch,
  mailboxHref,
} from "#/modules/mailbox/adapters/react/MailboxRouting";

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

/** Builds one canonical mailbox URL while preserving its folder or label context. */
export const mailboxViewHref = (
  selection: MailboxViewSelection,
  threadId?: string,
  messageId?: string,
  state: MailboxMessageQueryState = {}
) =>
  mailboxHref(
    decodeMailboxSearch({
      ...selection,
      attachment: state.hasAttachment ? "true" : undefined,
      delivery: state.delivery,
      message: messageId,
      q: state.query,
      read: state.read,
      starred: state.starred ? "true" : undefined,
      thread: threadId,
    })
  );

export const mailboxDraftHref = (
  folderId: string,
  draftId: string,
  deliveryId?: string
) =>
  mailboxHref(
    decodeMailboxSearch({
      draft: draftId,
      delivery: deliveryId,
      folder: folderId,
    })
  );

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

export const mailboxInboundAttachmentHref = (
  mailboxId: string,
  messageId: string,
  attachmentId: string,
  selection: MailboxViewSelection
) => {
  const query = new URLSearchParams();
  if (selection.folder !== undefined) {
    query.set("folder", selection.folder);
  } else if (selection.label !== undefined) {
    query.set("label", selection.label);
  }
  return `/api/mailboxes/${encodeURIComponent(mailboxId)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/download?${query.toString()}`;
};
