import { createServerFn } from "@tanstack/react-start";
import * as Schema from "effect/Schema";

import {
  MailboxDisplayNamePayloadSchema,
  RenameMailboxInputSchema,
} from "../http/mailbox-contract";
import { websiteBackend } from "./backend";

const bootstrapInput = Schema.decodeUnknownSync(
  MailboxDisplayNamePayloadSchema
);
const renameInput = Schema.decodeUnknownSync(RenameMailboxInputSchema);

export const bootstrapMailboxOwner = createServerFn({ method: "POST" })
  .validator(bootstrapInput)
  .handler(({ data }) =>
    websiteBackend.bootstrapMailboxOwner(data.displayName)
  );

export const renameMailbox = createServerFn({ method: "POST" })
  .validator(renameInput)
  .handler(({ data }) => websiteBackend.renameMailbox(data));
