import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { forwardMailboxMutation } from "./backend";
import { env } from "./env";
import { traceBackendRequest } from "./tracing";

interface BootstrapOwnerInput {
  readonly displayName: string;
}

interface RenameMailboxInput extends BootstrapOwnerInput {
  readonly mailboxId: string;
}

const bootstrapInput = (input: unknown): BootstrapOwnerInput => {
  if (
    typeof input !== "object" ||
    input === null ||
    !("displayName" in input) ||
    typeof input.displayName !== "string"
  ) {
    throw new TypeError("Invalid mailbox bootstrap input");
  }
  const { displayName } = input;
  return { displayName };
};

const renameInput = (input: unknown): RenameMailboxInput => {
  const bootstrap = bootstrapInput(input);
  if (!("mailboxId" in (input as object))) {
    throw new TypeError("Invalid mailbox rename input");
  }
  const { mailboxId } = input as { readonly mailboxId: unknown };
  if (typeof mailboxId !== "string") {
    throw new TypeError("Invalid mailbox rename input");
  }
  return { ...bootstrap, mailboxId };
};

export const bootstrapMailboxOwner = createServerFn({ method: "POST" })
  .validator(bootstrapInput)
  .handler(({ data }) => {
    const request = getRequest();
    return traceBackendRequest("website.mailbox.bootstrap", request, () =>
      forwardMailboxMutation({
        backend: env.BACKEND,
        incoming: request,
        method: "POST",
        path: "/api/mailboxes/bootstrap-owner",
        payload: { displayName: data.displayName },
      })
    );
  });

export const renameMailbox = createServerFn({ method: "POST" })
  .validator(renameInput)
  .handler(({ data }) => {
    const request = getRequest();
    return traceBackendRequest("website.mailbox.rename", request, () =>
      forwardMailboxMutation({
        backend: env.BACKEND,
        incoming: request,
        method: "PATCH",
        path: `/api/mailboxes/${encodeURIComponent(data.mailboxId)}`,
        payload: { displayName: data.displayName },
      })
    );
  });
