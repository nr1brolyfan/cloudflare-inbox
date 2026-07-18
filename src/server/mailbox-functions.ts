import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { forwardMailboxMutation } from "./backend";
import { env } from "./env";

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
  .handler(({ data }) =>
    forwardMailboxMutation({
      backend: env.BACKEND,
      incoming: getRequest(),
      method: "POST",
      path: "/api/mailboxes/bootstrap-owner",
      payload: { displayName: data.displayName },
    })
  );

export const renameMailbox = createServerFn({ method: "POST" })
  .validator(renameInput)
  .handler(({ data }) =>
    forwardMailboxMutation({
      backend: env.BACKEND,
      incoming: getRequest(),
      method: "PATCH",
      path: `/api/mailboxes/${encodeURIComponent(data.mailboxId)}`,
      payload: { displayName: data.displayName },
    })
  );
