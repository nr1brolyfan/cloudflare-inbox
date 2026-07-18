import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import * as Schema from "effect/Schema";

import { DevEmailRecordSchema } from "../http/dev-emails";
import type { DevEmailRecord } from "../http/dev-emails";
import { env } from "./env";
import { traceBackendRequest } from "./tracing";

const DevEmailListResponseSchema = Schema.Struct({
  messages: Schema.Array(DevEmailRecordSchema),
});

const inboxEnabled = () => String(env.DEV_EMAIL_INBOX_ENABLED) === "true";

const requestBackend = async (method: "DELETE" | "GET") => {
  const incoming = getRequest();
  const url = new URL("/api/dev-emails", incoming.url);
  const response = await traceBackendRequest(
    "website.dev_email.backend",
    incoming,
    () => env.BACKEND.fetch(new Request(url, { method }))
  );

  if (!response.ok) {
    throw new Error("Development email inbox is unavailable");
  }

  return response;
};

export type DevEmailInboxResult =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly messages: readonly DevEmailRecord[] };

export const getDevEmailInboxStatus = createServerFn({
  method: "GET",
}).handler(() => ({ enabled: inboxEnabled() }));

export const listDevEmails = createServerFn({ method: "GET" }).handler(
  async (): Promise<DevEmailInboxResult> => {
    if (!inboxEnabled()) {
      return { enabled: false };
    }

    const response = await requestBackend("GET");
    const body = Schema.decodeUnknownSync(DevEmailListResponseSchema)(
      await response.json()
    );

    return { enabled: true, messages: body.messages };
  }
);

export const clearDevEmails = createServerFn({ method: "POST" }).handler(
  async () => {
    if (!inboxEnabled()) {
      return { enabled: false as const };
    }

    await requestBackend("DELETE");
    return { enabled: true as const };
  }
);
