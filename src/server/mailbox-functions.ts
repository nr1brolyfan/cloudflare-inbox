import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  MailboxDisplayNamePayloadSchema,
  RenameMailboxInputSchema,
} from "../http/mailbox-contract";
import { forwardMailboxMutation } from "./backend";
import { BackendClientLive } from "./backend-client-live";

const bootstrapInput = Schema.decodeUnknownSync(
  MailboxDisplayNamePayloadSchema
);
const renameInput = Schema.decodeUnknownSync(RenameMailboxInputSchema);

export const bootstrapMailboxOwner = createServerFn({ method: "POST" })
  .validator(bootstrapInput)
  .handler(({ data }) => {
    const request = getRequest();
    return Effect.runPromise(
      forwardMailboxMutation({
        incoming: request,
        method: "POST",
        operation: "website.mailbox.bootstrap",
        path: "/api/mailboxes/bootstrap-owner",
        payload: { displayName: data.displayName },
      }).pipe(Effect.provide(BackendClientLive))
    );
  });

export const renameMailbox = createServerFn({ method: "POST" })
  .validator(renameInput)
  .handler(({ data }) => {
    const request = getRequest();
    return Effect.runPromise(
      forwardMailboxMutation({
        incoming: request,
        method: "PATCH",
        operation: "website.mailbox.rename",
        path: `/api/mailboxes/${encodeURIComponent(data.mailboxId)}`,
        payload: { displayName: data.displayName },
      }).pipe(Effect.provide(BackendClientLive))
    );
  });
