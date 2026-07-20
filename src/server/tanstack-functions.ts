import { createServerFn } from "@tanstack/react-start";
import * as Schema from "effect/Schema";

import {
  BootstrapOwnerMailboxCommand,
  RenameMailboxCommand,
} from "../mailboxes/administration";
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

export const bootstrapMailboxOwner = createServerFn({ method: "POST" })
  .validator(bootstrapInput)
  .handler(({ data }) =>
    websiteBackend.bootstrapMailboxOwner(data.displayName)
  );

export const renameMailbox = createServerFn({ method: "POST" })
  .validator(renameInput)
  .handler(({ data }) => websiteBackend.renameMailbox(data));

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

export const listDevEmails = createServerFn({ method: "GET" }).handler(() =>
  websiteBackend.listDevEmails()
);

export const clearDevEmails = createServerFn({ method: "POST" }).handler(() =>
  websiteBackend.clearDevEmails()
);
