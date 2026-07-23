import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { CreateDraftInput } from "#/modules/mailbox/domain/MailboxDraft";

describe("mailbox draft contracts", () => {
  it("defines an idempotent public draft command", () => {
    expect(
      Schema.decodeUnknownSync(CreateDraftInput)({
        mailboxId: "primary",
        operationId: "compose-1",
        content: {
          to: [{ address: "recipient@example.com" }],
          cc: [],
          bcc: [],
          subject: "Draft subject",
          textBody: "Draft body",
          attachmentIds: [],
        },
      })
    ).toMatchObject({ operationId: "compose-1" });
  });
});
