import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  clearDraftEditorFields,
  clearPendingDraftCreate,
  persistDraftEditorFields,
  persistPendingDraftCreate,
  readDraftEditorFields,
  readPendingDraftCreate,
} from "#/modules/mailbox/adapters/browser/DraftSessionStorage";
import { CreateMailboxDraftCommand } from "#/modules/mailbox/application/MailboxDraftEditing";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const fields = {
  bcc: "",
  cc: "unfinished <",
  subject: "Partial",
  textBody: "Raw body",
  to: "not-yet-valid",
};

describe("draft editor session storage", () => {
  it("recovers invalid raw fields only in the matching mailbox and compose session", () => {
    const storage = new MemoryStorage();
    persistDraftEditorFields(storage, "primary", "compose", fields);

    expect(readDraftEditorFields(storage, "primary", "compose")).toStrictEqual(
      fields
    );
    expect(readDraftEditorFields(storage, "other", "compose")).toBeUndefined();
    expect(
      readDraftEditorFields(storage, "primary", "draft-1")
    ).toBeUndefined();

    clearDraftEditorFields(storage, "primary", "compose");
    expect(
      readDraftEditorFields(storage, "primary", "compose")
    ).toBeUndefined();
  });

  it("drops malformed stored payloads", () => {
    const storage = new MemoryStorage();
    persistDraftEditorFields(storage, "primary", "compose", fields);
    const [key] = storage.values.keys();
    if (key === undefined) {
      throw new Error("Expected storage key");
    }
    storage.setItem(key, JSON.stringify({ subject: 42 }));
    expect(
      readDraftEditorFields(storage, "primary", "compose")
    ).toBeUndefined();
    expect(storage.values.size).toBe(0);
  });

  it("retains an exact uncertain create command for safe reload retry", () => {
    const storage = new MemoryStorage();
    const command = Schema.decodeUnknownSync(CreateMailboxDraftCommand)({
      content: {
        bcc: [],
        cc: [],
        subject: "Recovered create",
        textBody: "Body",
        to: [{ address: "person@example.test" }],
      },
      mailboxId: "primary",
      operationId: "operation-1",
    });

    persistPendingDraftCreate(storage, command);
    expect(readPendingDraftCreate(storage, "primary")).toStrictEqual(command);
    expect(readPendingDraftCreate(storage, "other")).toBeUndefined();

    clearPendingDraftCreate(storage, "primary");
    expect(readPendingDraftCreate(storage, "primary")).toBeUndefined();
  });
});
