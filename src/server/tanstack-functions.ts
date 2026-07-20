import { createServerFn } from "@tanstack/react-start";
import * as Schema from "effect/Schema";

import {
  BootstrapOwnerMailboxCommand,
  RenameMailboxCommand,
} from "../mailboxes/administration";
import { ReserveDraftAttachmentCommand } from "../mailboxes/draft-attachments";
import {
  CreateMailboxDraftCommand,
  GetMailboxDraftQuery,
  UpdateMailboxDraftCommand,
} from "../mailboxes/draft-editing";
import { MailboxMessageActionCommand } from "../mailboxes/message-actions";
import {
  MailboxMessageListInput,
  OpenMailboxThreadInput,
} from "../mailboxes/message-reading";
import { websiteBackend } from "./backend";

export type { DevEmailInboxResult } from "./dev-email-backend";

const bootstrapInput = Schema.decodeUnknownSync(BootstrapOwnerMailboxCommand);
const renameInput = Schema.decodeUnknownSync(RenameMailboxCommand);
const mailboxMessageListInput = Schema.decodeUnknownSync(
  MailboxMessageListInput
);
const openMailboxThreadInput = Schema.decodeUnknownSync(OpenMailboxThreadInput);
const mailboxMessageActionInput = Schema.decodeUnknownSync(
  MailboxMessageActionCommand
);
const createMailboxDraftInput = Schema.decodeUnknownSync(
  CreateMailboxDraftCommand
);
const getMailboxDraftInput = Schema.decodeUnknownSync(GetMailboxDraftQuery);
const updateMailboxDraftInput = Schema.decodeUnknownSync(
  UpdateMailboxDraftCommand
);
const reserveDraftAttachmentInput = Schema.decodeUnknownSync(
  ReserveDraftAttachmentCommand
);

export const actOnMailboxMessage = createServerFn({ method: "POST" })
  .validator(mailboxMessageActionInput)
  .handler(({ data }) => websiteBackend.actOnMailboxMessage(data));

export const bootstrapMailboxOwner = createServerFn({ method: "POST" })
  .validator(bootstrapInput)
  .handler(({ data }) =>
    websiteBackend.bootstrapMailboxOwner(data.displayName)
  );

export const createMailboxDraft = createServerFn({ method: "POST" })
  .validator(createMailboxDraftInput)
  .handler(({ data }) => websiteBackend.createMailboxDraft(data));

export const getMailboxDraft = createServerFn({ method: "GET" })
  .validator(getMailboxDraftInput)
  .handler(({ data }) => websiteBackend.getMailboxDraft(data));

export const renameMailbox = createServerFn({ method: "POST" })
  .validator(renameInput)
  .handler(({ data }) => websiteBackend.renameMailbox(data));

export const reserveMailboxDraftAttachment = createServerFn({ method: "POST" })
  .validator(reserveDraftAttachmentInput)
  .handler(({ data }) => websiteBackend.reserveMailboxDraftAttachment(data));

export const getDevEmailInboxStatus = createServerFn({
  method: "GET",
}).handler(() => websiteBackend.getDevEmailInboxStatus());

export const getMailboxNavigation = createServerFn({ method: "GET" }).handler(
  () => websiteBackend.getMailboxNavigation()
);

export const listMailboxMessages = createServerFn({ method: "GET" })
  .validator(mailboxMessageListInput)
  .handler(({ data }) => websiteBackend.listMailboxMessages(data));

export const getMailboxThread = createServerFn({ method: "GET" })
  .validator(openMailboxThreadInput)
  .handler(({ data }) => websiteBackend.getMailboxThread(data));

export const updateMailboxDraft = createServerFn({ method: "POST" })
  .validator(updateMailboxDraftInput)
  .handler(({ data }) => websiteBackend.updateMailboxDraft(data));

export const listDevEmails = createServerFn({ method: "GET" }).handler(() =>
  websiteBackend.listDevEmails()
);

export const clearDevEmails = createServerFn({ method: "POST" }).handler(() =>
  websiteBackend.clearDevEmails()
);
