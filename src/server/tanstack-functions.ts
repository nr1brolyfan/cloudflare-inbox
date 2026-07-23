import { createServerFn } from "@tanstack/react-start";
import * as Schema from "effect/Schema";

import {
  CreateMailboxDraftCommand,
  GetMailboxDraftQuery,
  UpdateMailboxDraftCommand,
} from "#/modules/mailbox/application/MailboxDraftEditing";
import { MailboxDraftListInput } from "#/modules/mailbox/application/MailboxDraftReading";
import { MailboxMessageActionCommand } from "#/modules/mailbox/application/MailboxMessageActions";
import {
  MailboxMessageListInput,
  OpenMailboxThreadInput,
} from "#/modules/mailbox/application/MailboxMessageReading";
import { ReserveDraftAttachmentCommand } from "#/modules/mailbox/domain/MailboxDraftAttachment";

import {
  BootstrapOwnerMailboxCommand,
  RenameMailboxCommand,
} from "../mailboxes/administration";
import { GetMailboxOutboundDeliveryQuery } from "../mailboxes/outbound-delivery-reading";
import {
  SendMailboxDraftCommand,
  UndoMailboxSendCommand,
} from "../mailboxes/outbound-sending";
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
const mailboxDraftListInput = Schema.decodeUnknownSync(MailboxDraftListInput);
const reserveDraftAttachmentInput = Schema.decodeUnknownSync(
  ReserveDraftAttachmentCommand
);
const sendMailboxDraftInput = Schema.decodeUnknownSync(SendMailboxDraftCommand);
const undoMailboxSendInput = Schema.decodeUnknownSync(UndoMailboxSendCommand);
const getMailboxOutboundDeliveryInput = Schema.decodeUnknownSync(
  GetMailboxOutboundDeliveryQuery
);

export const actOnMailboxMessage = createServerFn({ method: "POST" })
  .validator(mailboxMessageActionInput)
  .handler(({ data }) => websiteBackend.actOnMailboxMessage(data));

export const bootstrapMailboxOwner = createServerFn({ method: "POST" })
  .validator(bootstrapInput)
  .handler(({ data }) => websiteBackend.bootstrapMailboxOwner(data));

export const createMailboxDraft = createServerFn({ method: "POST" })
  .validator(createMailboxDraftInput)
  .handler(({ data }) => websiteBackend.createMailboxDraft(data));

export const getMailboxDraft = createServerFn({ method: "GET" })
  .validator(getMailboxDraftInput)
  .handler(({ data }) => websiteBackend.getMailboxDraft(data));

export const getMailboxOutboundDelivery = createServerFn({ method: "GET" })
  .validator(getMailboxOutboundDeliveryInput)
  .handler(({ data }) => websiteBackend.getMailboxOutboundDelivery(data));

export const renameMailbox = createServerFn({ method: "POST" })
  .validator(renameInput)
  .handler(({ data }) => websiteBackend.renameMailbox(data));

export const reserveMailboxDraftAttachment = createServerFn({ method: "POST" })
  .validator(reserveDraftAttachmentInput)
  .handler(({ data }) => websiteBackend.reserveMailboxDraftAttachment(data));

export const sendMailboxDraft = createServerFn({ method: "POST" })
  .validator(sendMailboxDraftInput)
  .handler(({ data }) => websiteBackend.sendMailboxDraft(data));

export const getDevEmailInboxStatus = createServerFn({
  method: "GET",
}).handler(() => websiteBackend.getDevEmailInboxStatus());

export const getMailboxNavigation = createServerFn({ method: "GET" }).handler(
  () => websiteBackend.getMailboxNavigation()
);

export const listMailboxMessages = createServerFn({ method: "GET" })
  .validator(mailboxMessageListInput)
  .handler(({ data }) => websiteBackend.listMailboxMessages(data));

export const listMailboxDrafts = createServerFn({ method: "GET" })
  .validator(mailboxDraftListInput)
  .handler(({ data }) => websiteBackend.listMailboxDrafts(data));

export const getMailboxThread = createServerFn({ method: "GET" })
  .validator(openMailboxThreadInput)
  .handler(({ data }) => websiteBackend.getMailboxThread(data));

export const updateMailboxDraft = createServerFn({ method: "POST" })
  .validator(updateMailboxDraftInput)
  .handler(({ data }) => websiteBackend.updateMailboxDraft(data));

export const undoMailboxSend = createServerFn({ method: "POST" })
  .validator(undoMailboxSendInput)
  .handler(({ data }) => websiteBackend.undoMailboxSend(data));

export const listDevEmails = createServerFn({ method: "GET" }).handler(() =>
  websiteBackend.listDevEmails()
);

export const clearDevEmails = createServerFn({ method: "POST" }).handler(() =>
  websiteBackend.clearDevEmails()
);
