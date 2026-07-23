import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { InboundIngestId } from "#/modules/mailbox/domain/Mailbox";
import { WorkflowStartError } from "#/modules/mailbox/ports/MailboxWorkflowStarter";

describe("mailbox workflow starter error", () => {
  it("keeps Workflow identity tied to the inbound ingest", () => {
    const error = new WorkflowStartError({
      cause: new Error("binding unavailable"),
      instanceId: Schema.decodeUnknownSync(InboundIngestId)("ingest-1"),
      message: "Failed to start inbound workflow",
      workflow: "inbound",
    });

    expect(error).toMatchObject({
      _tag: "WorkflowStartError",
      instanceId: "ingest-1",
      workflow: "inbound",
    });
  });
});
