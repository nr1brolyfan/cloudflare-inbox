import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { DevEmailListSchema } from "../http/dev-email-contract";
import type { DevEmailRecord } from "../http/dev-email-contract";
import { BackendClient } from "./backend-client";
import { BackendClientLive } from "./backend-client-live";
import { env } from "./env";

const inboxEnabled = () => String(env.DEV_EMAIL_INBOX_ENABLED) === "true";

const requestBackend = (method: "DELETE" | "GET") =>
  Effect.gen(function* () {
    const backend = yield* BackendClient;
    const incoming = getRequest();
    const url = new URL("/api/dev-emails", incoming.url);
    const response = yield* backend.fetch(
      "website.dev_email.backend",
      new Request(url, { method })
    );

    if (!response.ok) {
      return yield* Effect.die(
        new Error("Development email inbox is unavailable")
      );
    }

    return response;
  });

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

    const response = await Effect.runPromise(
      requestBackend("GET").pipe(Effect.provide(BackendClientLive))
    );
    const body = Schema.decodeUnknownSync(DevEmailListSchema)(
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

    await Effect.runPromise(
      requestBackend("DELETE").pipe(Effect.provide(BackendClientLive))
    );
    return { enabled: true as const };
  }
);
