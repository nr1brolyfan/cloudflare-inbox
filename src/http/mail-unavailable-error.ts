import * as Schema from "effect/Schema";

export class MailUnavailableError extends Schema.TaggedErrorClass<MailUnavailableError>()(
  "MailUnavailableError",
  {
    code: Schema.Literal("temporarily_unavailable"),
    message: Schema.Literal("Mail service is temporarily unavailable"),
  },
  { httpApiStatus: 503 }
) {}
