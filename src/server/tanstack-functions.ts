import { createServerFn } from "@tanstack/react-start";
import * as Schema from "effect/Schema";

import {
  BootstrapOwnerMailboxCommand,
  RenameMailboxCommand,
} from "../mailboxes/administration";
import { websiteBackend } from "./backend";

export type { DevEmailInboxResult } from "./dev-email-backend";

const bootstrapInput = Schema.decodeUnknownSync(BootstrapOwnerMailboxCommand);
const renameInput = Schema.decodeUnknownSync(RenameMailboxCommand);

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

export const listDevEmails = createServerFn({ method: "GET" }).handler(() =>
  websiteBackend.listDevEmails()
);

export const clearDevEmails = createServerFn({ method: "POST" }).handler(() =>
  websiteBackend.clearDevEmails()
);
