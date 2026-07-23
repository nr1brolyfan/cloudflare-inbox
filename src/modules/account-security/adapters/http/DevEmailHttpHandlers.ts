import { DevEmailStore } from "@effect-auth/core/DevEmail";
import type { DevEmailMessage } from "@effect-auth/core/DevEmail";
import {
  AuthInternalError,
  AuthNotFoundError,
} from "@effect-auth/core/HttpApi";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { BackendHttpApi } from "#/http/api";

import type { DevEmailRecord } from "./DevEmailHttpApi";

export interface DevEmailConfigShape {
  readonly isDevelopment: boolean;
}

/** Deployment mode required only by the development inbox adapter. */
export class DevEmailConfig extends Context.Service<
  DevEmailConfig,
  DevEmailConfigShape
>()("cloudflare-inbox/DevEmailConfig") {}

const storeUnavailable = () =>
  new AuthInternalError({
    code: "internal_error",
    message: "Development email inbox is unavailable",
  });

const toRecord = (message: DevEmailMessage): DevEmailRecord => ({
  id: message.id,
  kind: message.kind,
  recipient: message.recipient,
  ...(message.sender === undefined ? {} : { sender: message.sender }),
  subject: message.subject,
  ...(message.text === undefined ? {} : { text: message.text }),
  ...(message.html === undefined ? {} : { html: message.html }),
  createdAt: Number(message.createdAt),
  expiresAt: Number(message.expiresAt),
});

/** Development-only handlers; production requests fail with a typed 404. */
export const DevEmailHttpHandlersLayer = HttpApiBuilder.group(
  BackendHttpApi,
  "devEmails",
  Effect.fn("backend.http.dev_email_group")(function* (handlers) {
    const config = yield* DevEmailConfig;
    const store = yield* DevEmailStore;
    const requireDevelopment = config.isDevelopment
      ? Effect.void
      : Effect.fail(
          new AuthNotFoundError({
            code: "not_found",
            message: "Not found",
          })
        );

    return handlers
      .handle("list", () =>
        requireDevelopment.pipe(
          Effect.andThen(
            Effect.suspend(() =>
              store.list({ limit: 50 }).pipe(Effect.mapError(storeUnavailable))
            )
          ),
          Effect.map((messages) => ({ messages: messages.map(toRecord) }))
        )
      )
      .handle("clear", () =>
        requireDevelopment.pipe(
          Effect.andThen(
            Effect.suspend(() =>
              store.clear().pipe(Effect.mapError(storeUnavailable))
            )
          ),
          Effect.as({ cleared: true as const })
        )
      );
  })
);
