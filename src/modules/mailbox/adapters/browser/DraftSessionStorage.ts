import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { CreateMailboxDraftCommand } from "#/modules/mailbox/application/MailboxDraftEditing";

export const DraftEditorFields = Schema.Struct({
  bcc: Schema.String,
  cc: Schema.String,
  subject: Schema.String,
  textBody: Schema.String,
  to: Schema.String,
});
export type DraftEditorFields = Schema.Schema.Type<typeof DraftEditorFields>;

interface SessionStorageLike {
  readonly getItem: (key: string) => string | null;
  readonly removeItem: (key: string) => void;
  readonly setItem: (key: string, value: string) => void;
}

const maximumPayloadLength = 1_100_000;
const keyFor = (mailboxId: string, composeSession: string) =>
  `cloudflare-inbox:draft-fields:v1:${encodeURIComponent(mailboxId)}:${encodeURIComponent(composeSession)}`;
const pendingCreateKeyFor = (mailboxId: string) =>
  `cloudflare-inbox:draft-create:v1:${encodeURIComponent(mailboxId)}`;

export const readPendingDraftCreate = (
  storage: SessionStorageLike,
  mailboxId: string
): Schema.Schema.Type<typeof CreateMailboxDraftCommand> | undefined => {
  const key = pendingCreateKeyFor(mailboxId);
  try {
    const payload = storage.getItem(key);
    if (payload === null) {
      return undefined;
    }
    if (payload.length > maximumPayloadLength) {
      storage.removeItem(key);
      return undefined;
    }
    const decoded = Result.try({
      try: () => JSON.parse(payload),
      catch: () => null,
    }).pipe(
      Result.flatMap(Schema.decodeUnknownResult(CreateMailboxDraftCommand))
    );
    if (Result.isFailure(decoded) || decoded.success.mailboxId !== mailboxId) {
      storage.removeItem(key);
      return undefined;
    }
    return decoded.success;
  } catch {
    return undefined;
  }
};

export const persistPendingDraftCreate = (
  storage: SessionStorageLike,
  command: Schema.Schema.Type<typeof CreateMailboxDraftCommand>
) => {
  try {
    const payload = JSON.stringify(
      Schema.encodeSync(CreateMailboxDraftCommand)(command)
    );
    if (payload.length <= maximumPayloadLength) {
      storage.setItem(pendingCreateKeyFor(command.mailboxId), payload);
    }
  } catch {
    // Storage denial must not prevent creating a server draft.
  }
};

export const clearPendingDraftCreate = (
  storage: SessionStorageLike,
  mailboxId: string
) => {
  try {
    storage.removeItem(pendingCreateKeyFor(mailboxId));
  } catch {
    // Storage denial is non-fatal.
  }
};

export const readDraftEditorFields = (
  storage: SessionStorageLike,
  mailboxId: string,
  composeSession: string
): DraftEditorFields | undefined => {
  const key = keyFor(mailboxId, composeSession);
  try {
    const payload = storage.getItem(key);
    if (payload === null) {
      return undefined;
    }
    if (payload.length > maximumPayloadLength) {
      storage.removeItem(key);
      return undefined;
    }
    const decoded = Result.try({
      try: () => JSON.parse(payload),
      catch: () => null,
    }).pipe(Result.flatMap(Schema.decodeUnknownResult(DraftEditorFields)));
    if (Result.isFailure(decoded)) {
      storage.removeItem(key);
      return undefined;
    }
    return decoded.success;
  } catch {
    return undefined;
  }
};

export const persistDraftEditorFields = (
  storage: SessionStorageLike,
  mailboxId: string,
  composeSession: string,
  fields: DraftEditorFields
) => {
  try {
    const payload = JSON.stringify(
      Schema.encodeSync(DraftEditorFields)(fields)
    );
    if (payload.length <= maximumPayloadLength) {
      storage.setItem(keyFor(mailboxId, composeSession), payload);
    }
  } catch {
    // Storage denial must not prevent editing or server persistence.
  }
};

export const clearDraftEditorFields = (
  storage: SessionStorageLike,
  mailboxId: string,
  composeSession: string
) => {
  try {
    storage.removeItem(keyFor(mailboxId, composeSession));
  } catch {
    // Storage denial is non-fatal.
  }
};

export const draftEditorFieldsEqual = (
  left: DraftEditorFields,
  right: DraftEditorFields
) =>
  left.bcc === right.bcc &&
  left.cc === right.cc &&
  left.subject === right.subject &&
  left.textBody === right.textBody &&
  left.to === right.to;
