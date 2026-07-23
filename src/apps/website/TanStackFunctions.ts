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
import { GetMailboxOutboundDeliveryQuery } from "#/modules/mailbox/application/MailboxOutboundDeliveryReading";
import {
  SendMailboxDraftCommand,
  UndoMailboxSendCommand,
} from "#/modules/mailbox/application/MailboxOutboundSending";
import { ReserveDraftAttachmentCommand } from "#/modules/mailbox/domain/MailboxDraftAttachment";
import {
  BootstrapOwnerMailboxCommand,
  RenameMailboxCommand,
} from "#/modules/organization/application/MailboxAdministration";

import { WebsiteApplication } from "./WebsiteApplication";

export type { DevEmailInboxResult } from "./DevEmailOperations";

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
  .handler(({ data }) => WebsiteApplication.actOnMailboxMessage(data));

export const bootstrapMailboxOwner = createServerFn({ method: "POST" })
  .validator(bootstrapInput)
  .handler(({ data }) => WebsiteApplication.bootstrapMailboxOwner(data));

export const createMailboxDraft = createServerFn({ method: "POST" })
  .validator(createMailboxDraftInput)
  .handler(({ data }) => WebsiteApplication.createMailboxDraft(data));

export const getMailboxDraft = createServerFn({ method: "GET" })
  .validator(getMailboxDraftInput)
  .handler(({ data }) => WebsiteApplication.getMailboxDraft(data));

export const getMailboxOutboundDelivery = createServerFn({ method: "GET" })
  .validator(getMailboxOutboundDeliveryInput)
  .handler(({ data }) => WebsiteApplication.getMailboxOutboundDelivery(data));

export const renameMailbox = createServerFn({ method: "POST" })
  .validator(renameInput)
  .handler(({ data }) => WebsiteApplication.renameMailbox(data));

export const reserveMailboxDraftAttachment = createServerFn({ method: "POST" })
  .validator(reserveDraftAttachmentInput)
  .handler(({ data }) =>
    WebsiteApplication.reserveMailboxDraftAttachment(data)
  );

export const sendMailboxDraft = createServerFn({ method: "POST" })
  .validator(sendMailboxDraftInput)
  .handler(({ data }) => WebsiteApplication.sendMailboxDraft(data));

export const getDevEmailInboxStatus = createServerFn({
  method: "GET",
}).handler(() => WebsiteApplication.getDevEmailInboxStatus());

export const getMailboxNavigation = createServerFn({ method: "GET" }).handler(
  () => WebsiteApplication.getMailboxNavigation()
);

export const listMailboxMessages = createServerFn({ method: "GET" })
  .validator(mailboxMessageListInput)
  .handler(({ data }) => WebsiteApplication.listMailboxMessages(data));

export const listMailboxDrafts = createServerFn({ method: "GET" })
  .validator(mailboxDraftListInput)
  .handler(({ data }) => WebsiteApplication.listMailboxDrafts(data));

export const getMailboxThread = createServerFn({ method: "GET" })
  .validator(openMailboxThreadInput)
  .handler(({ data }) => WebsiteApplication.getMailboxThread(data));

export const updateMailboxDraft = createServerFn({ method: "POST" })
  .validator(updateMailboxDraftInput)
  .handler(({ data }) => WebsiteApplication.updateMailboxDraft(data));

export const undoMailboxSend = createServerFn({ method: "POST" })
  .validator(undoMailboxSendInput)
  .handler(({ data }) => WebsiteApplication.undoMailboxSend(data));

export const listDevEmails = createServerFn({ method: "GET" }).handler(() =>
  WebsiteApplication.listDevEmails()
);

export const clearDevEmails = createServerFn({ method: "POST" }).handler(() =>
  WebsiteApplication.clearDevEmails()
);
