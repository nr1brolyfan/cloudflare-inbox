import { DevEmailStore } from "@effect-auth/core/DevEmail";
import type { DevEmailMessage } from "@effect-auth/core/DevEmail";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";

const DevEmailKindSchema = Schema.Literals([
  "EmailAuth",
  "EmailOtp",
  "MagicLink",
  "PasswordReset",
  "EmailVerification",
  "LoginApproval",
  "LoginNotification",
]);

const DevEmailSenderSchema = Schema.Union([
  Schema.String,
  Schema.Struct({
    email: Schema.String,
    name: Schema.optional(Schema.String),
  }),
]);

export const DevEmailRecordSchema = Schema.Struct({
  id: Schema.String,
  kind: DevEmailKindSchema,
  recipient: Schema.String,
  sender: Schema.optional(DevEmailSenderSchema),
  subject: Schema.String,
  text: Schema.optional(Schema.String),
  html: Schema.optional(Schema.String),
  createdAt: Schema.Number,
  expiresAt: Schema.Number,
});

export type DevEmailRecord = Schema.Schema.Type<typeof DevEmailRecordSchema>;

const DevEmailListSchema = Schema.Struct({
  messages: Schema.Array(DevEmailRecordSchema),
});

const DevEmailClearedSchema = Schema.Struct({
  cleared: Schema.Literal(true),
});

const ListDevEmailsEndpoint = HttpApiEndpoint.get("list", "/api/dev-emails", {
  success: DevEmailListSchema,
});

const ClearDevEmailsEndpoint = HttpApiEndpoint.delete(
  "clear",
  "/api/dev-emails",
  { success: DevEmailClearedSchema }
);

class DevEmailGroup extends HttpApiGroup.make("devEmails").add(
  ListDevEmailsEndpoint,
  ClearDevEmailsEndpoint
) {}

const DevEmailHttpApi = HttpApi.make("DevEmailHttpApi").add(DevEmailGroup);

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

const DevEmailGroupLive = HttpApiBuilder.group(
  DevEmailHttpApi,
  "devEmails",
  Effect.fn("backend.http.dev_email_group")(function* (handlers) {
    const store = yield* DevEmailStore;

    return handlers
      .handle("list", () =>
        store.list({ limit: 50 }).pipe(
          Effect.orDie,
          Effect.map((messages) => ({ messages: messages.map(toRecord) }))
        )
      )
      .handle("clear", () =>
        store.clear().pipe(Effect.orDie, Effect.as({ cleared: true as const }))
      );
  })
);

const DevEmailHttpLive = HttpApiBuilder.layer(DevEmailHttpApi);

export const makeDevEmailHttpLive = (storeLive: Layer.Layer<DevEmailStore>) =>
  DevEmailHttpLive.pipe(
    Layer.provide(DevEmailGroupLive.pipe(Layer.provide(storeLive)))
  );
