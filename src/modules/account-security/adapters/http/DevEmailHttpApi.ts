import {
  AuthInternalError,
  AuthNotFoundError,
} from "@effect-auth/core/HttpApi";
import * as Schema from "effect/Schema";
import {
  HttpApi,
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

export const DevEmailListSchema = Schema.Struct({
  messages: Schema.Array(DevEmailRecordSchema),
});

export const DevEmailClearedSchema = Schema.Struct({
  cleared: Schema.Literal(true),
});

export const ListDevEmailsEndpoint = HttpApiEndpoint.get(
  "list",
  "/api/dev-emails",
  {
    error: [AuthNotFoundError, AuthInternalError],
    success: DevEmailListSchema,
  }
);

export const ClearDevEmailsEndpoint = HttpApiEndpoint.delete(
  "clear",
  "/api/dev-emails",
  {
    error: [AuthNotFoundError, AuthInternalError],
    success: DevEmailClearedSchema,
  }
);

export class DevEmailGroup extends HttpApiGroup.make("devEmails").add(
  ListDevEmailsEndpoint,
  ClearDevEmailsEndpoint
) {}

export const DevEmailHttpApi = HttpApi.make("AuthApi").add(DevEmailGroup);
