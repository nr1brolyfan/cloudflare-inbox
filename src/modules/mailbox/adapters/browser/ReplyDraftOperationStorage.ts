import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { CreateMailboxReplyDraftCommand } from "#/modules/mailbox/application/MailboxReplyDraftCreation";

type ReplyCommand = Schema.Schema.Type<typeof CreateMailboxReplyDraftCommand>;
type FolderReplyCommand = Extract<ReplyCommand, { readonly _tag: "Folder" }>;
type LabelReplyCommand = Extract<ReplyCommand, { readonly _tag: "Label" }>;
type ReplyTarget =
  | Omit<FolderReplyCommand, "operationId">
  | Omit<LabelReplyCommand, "operationId">;

interface SessionStorageLike {
  readonly getItem: (key: string) => string | null;
  readonly removeItem: (key: string) => void;
  readonly setItem: (key: string, value: string) => void;
}

const storageKey = "cloudflare-inbox:reply-draft:v2:pending";
const maximumEntries = 16;
const maximumPayloadLength = 32_768;
const entryTtlMillis = 30 * 60 * 1000;

const PendingEntry = Schema.Struct({
  command: CreateMailboxReplyDraftCommand,
  touchedAt: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
});
const PendingEntries = Schema.Array(PendingEntry);
type PendingEntry = Schema.Schema.Type<typeof PendingEntry>;

const commandKey = (command: ReplyTarget) =>
  `${command.mailboxId}:${command._tag}:${command._tag === "Folder" ? command.folderId : command.labelId}:${command.threadId}:${command.messageId}`;

export const replyCommandsHaveSameTarget = (
  left: ReplyTarget,
  right: ReplyTarget
) => commandKey(left) === commandKey(right);

const writeEntries = (
  storage: SessionStorageLike,
  entries: readonly PendingEntry[]
) => {
  if (entries.length === 0) {
    storage.removeItem(storageKey);
    return;
  }
  const payload = JSON.stringify(Schema.encodeSync(PendingEntries)(entries));
  if (payload.length > maximumPayloadLength) {
    storage.removeItem(storageKey);
    return;
  }
  storage.setItem(storageKey, payload);
};

const readEntries = (storage: SessionStorageLike, now: number) => {
  const payload = storage.getItem(storageKey);
  if (payload === null || payload.length > maximumPayloadLength) {
    storage.removeItem(storageKey);
    return [];
  }
  const decoded = Result.try({
    try: (): unknown => JSON.parse(payload),
    catch: () => null,
  }).pipe(
    Result.flatMap((value) => Schema.decodeUnknownResult(PendingEntries)(value))
  );
  if (Result.isFailure(decoded)) {
    storage.removeItem(storageKey);
    return [];
  }
  const entries = decoded.success
    .filter(
      (entry) =>
        entry.touchedAt <= now && now - entry.touchedAt <= entryTtlMillis
    )
    .slice(-maximumEntries);
  if (entries.length !== decoded.success.length) {
    writeEntries(storage, entries);
  }
  return entries;
};

export const readPendingReplyCommand = (
  storage: SessionStorageLike,
  target: ReplyTarget,
  now = Date.now()
): ReplyCommand | undefined => {
  try {
    const entries = readEntries(storage, now);
    const match = entries.find((entry) =>
      replyCommandsHaveSameTarget(entry.command, target)
    );
    if (match === undefined) {
      return undefined;
    }
    writeEntries(storage, [
      ...entries.filter((entry) => entry !== match),
      { command: match.command, touchedAt: now },
    ]);
    return match.command;
  } catch {
    return undefined;
  }
};

export const persistPendingReplyCommand = (
  storage: SessionStorageLike,
  command: ReplyCommand,
  now = Date.now()
) => {
  try {
    const entries = readEntries(storage, now).filter(
      (entry) => !replyCommandsHaveSameTarget(entry.command, command)
    );
    writeEntries(
      storage,
      [...entries, { command, touchedAt: now }].slice(-maximumEntries)
    );
    return true;
  } catch {
    return false;
  }
};

export const clearPendingReplyCommand = (
  storage: SessionStorageLike,
  command: ReplyCommand,
  now = Date.now()
) => {
  try {
    writeEntries(
      storage,
      readEntries(storage, now).filter(
        (entry) => !replyCommandsHaveSameTarget(entry.command, command)
      )
    );
  } catch {
    // Storage denial is non-fatal; server idempotency remains authoritative.
  }
};

export const retainReplyOperationForStatus = (status?: number) =>
  status === undefined || status === 500 || status === 502;
