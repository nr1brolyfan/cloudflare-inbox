import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  clearPendingReplyCommand,
  persistPendingReplyCommand,
  readPendingReplyCommand,
  replyCommandsHaveSameTarget,
  retainReplyOperationForStatus,
} from "#/modules/mailbox/adapters/browser/ReplyDraftOperationStorage";
import { CreateMailboxReplyDraftCommand } from "#/modules/mailbox/application/MailboxReplyDraftCreation";

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

const folderCommand = (
  messageId: string,
  operationId: string,
  overrides: Record<string, unknown> = {}
) => {
  const command = Schema.decodeUnknownSync(CreateMailboxReplyDraftCommand)({
    _tag: "Folder",
    mailboxId: "primary",
    folderId: "inbox",
    messageId,
    threadId: "thread-1",
    operationId,
    ...overrides,
  });
  if (command._tag !== "Folder") {
    throw new Error("Expected folder command");
  }
  return command;
};

const targetOf = <A extends ReturnType<typeof folderCommand>>(command: A) => ({
  _tag: command._tag,
  mailboxId: command.mailboxId,
  folderId: command.folderId,
  messageId: command.messageId,
  threadId: command.threadId,
});

describe("reply draft operation session storage", () => {
  it("retains uncertain operations for multiple exact targets and clears only one", () => {
    const storage = new MemoryStorage();
    const first = folderCommand("message-1", "operation-1");
    const second = folderCommand("message-2", "operation-2");
    persistPendingReplyCommand(storage, first, 1000);
    persistPendingReplyCommand(storage, second, 2000);

    expect(
      readPendingReplyCommand(storage, targetOf(first), 3000)
    ).toStrictEqual(first);
    expect(
      readPendingReplyCommand(storage, targetOf(second), 3000)
    ).toStrictEqual(second);
    clearPendingReplyCommand(storage, second, 4000);
    expect(
      readPendingReplyCommand(storage, targetOf(first), 4000)
    ).toStrictEqual(first);
    expect(
      readPendingReplyCommand(storage, targetOf(second), 4000)
    ).toBeUndefined();

    const payload = JSON.stringify([...storage.values.values()]);
    expect(payload).not.toMatch(/password|content|textBody|htmlBody/u);
  });

  it("expires stale entries and evicts the least recently used beyond 16", () => {
    const storage = new MemoryStorage();
    const commands = Array.from({ length: 17 }, (_, index) =>
      folderCommand(`message-${index}`, `operation-${index}`)
    );
    for (const [index, command] of commands.entries()) {
      persistPendingReplyCommand(storage, command, index * 1000);
    }
    const [first] = commands;
    const last = commands.at(-1);
    if (first === undefined || last === undefined) {
      throw new Error("Expected capacity fixtures");
    }

    expect(
      readPendingReplyCommand(storage, targetOf(first), 17_000)
    ).toBeUndefined();
    expect(
      readPendingReplyCommand(storage, targetOf(last), 17_000)?.operationId
    ).toBe("operation-16");

    const expiring = folderCommand("expiring", "operation-expiring");
    persistPendingReplyCommand(storage, expiring, 20_000);
    expect(
      readPendingReplyCommand(
        storage,
        targetOf(expiring),
        20_000 + 31 * 60 * 1000
      )
    ).toBeUndefined();
  });

  it("validates stored commands and applies definitive versus uncertain retry semantics", () => {
    const storage = new MemoryStorage();
    const command = folderCommand("message-1", "operation-1");
    persistPendingReplyCommand(storage, command, 1000);
    const [key] = storage.values.keys();
    if (key === undefined) {
      throw new Error("Expected pending storage");
    }
    storage.setItem(
      key,
      JSON.stringify([{ command: { operationId: "forged" } }])
    );
    expect(
      readPendingReplyCommand(storage, targetOf(command), 2000)
    ).toBeUndefined();
    expect(storage.values.size).toBe(0);

    expect([
      retainReplyOperationForStatus(),
      retainReplyOperationForStatus(500),
      retainReplyOperationForStatus(502),
      retainReplyOperationForStatus(400),
      retainReplyOperationForStatus(404),
      retainReplyOperationForStatus(409),
    ]).toStrictEqual([true, true, true, false, false, false]);
  });

  it("compares full mailbox, thread, message, and Folder/Label context", () => {
    const base = folderCommand("same-message", "operation-1");
    expect(
      [
        folderCommand("same-message", "operation-2"),
        folderCommand("same-message", "operation-3", { mailboxId: "other" }),
        folderCommand("same-message", "operation-4", { threadId: "other" }),
        folderCommand("same-message", "operation-5", { folderId: "archive" }),
      ].map((candidate) => replyCommandsHaveSameTarget(base, candidate))
    ).toStrictEqual([true, false, false, false]);

    const label = Schema.decodeUnknownSync(CreateMailboxReplyDraftCommand)({
      _tag: "Label",
      mailboxId: "primary",
      labelId: "inbox",
      messageId: "same-message",
      threadId: "thread-1",
      operationId: "operation-label",
    });
    expect(replyCommandsHaveSameTarget(base, label)).toBeFalsy();
  });
});
