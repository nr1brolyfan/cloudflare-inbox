/* oxlint-disable max-classes-per-file -- Navigation domain schemas and errors are intentionally consolidated. */
import type { CurrentPrincipal } from "@effect-auth/core/Permission";
import type { CurrentActor } from "@effect-auth/core/Sessions";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  FolderId,
  FolderKind,
  FolderName,
  LabelId,
  LabelName,
  MailboxId,
} from "#/modules/mailbox/domain/Mailbox";
import type { MailboxAuthorizationError } from "#/modules/mailbox/ports/MailboxAuthorization";
import { MailboxDisplayName } from "#/modules/organization/domain/Mailbox";
import { MailboxNavigationReader } from "#/modules/organization/ports/MailboxNavigationReader";

export class MailboxNavigationMailbox extends Schema.Class<MailboxNavigationMailbox>(
  "cloudflare-inbox/MailboxNavigationMailbox"
)({
  id: MailboxId,
  displayName: MailboxDisplayName,
}) {}

export class MailboxNavigationFolder extends Schema.Class<MailboxNavigationFolder>(
  "cloudflare-inbox/MailboxNavigationFolder"
)({
  id: FolderId,
  kind: FolderKind,
  name: FolderName,
  messageCount: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  unreadCount: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
}) {}

export const MailboxNavigationFolderSchema = MailboxNavigationFolder.check(
  Schema.makeFilter((folder) =>
    folder.unreadCount <= folder.messageCount
      ? undefined
      : "unreadCount cannot exceed messageCount"
  )
);

export class MailboxNavigationLabel extends Schema.Class<MailboxNavigationLabel>(
  "cloudflare-inbox/MailboxNavigationLabel"
)({
  id: LabelId,
  name: LabelName,
}) {}

export const MailboxNavigationResult = Schema.Struct({
  mailbox: MailboxNavigationMailbox,
  folders: Schema.Array(MailboxNavigationFolderSchema),
  labels: Schema.Array(MailboxNavigationLabel),
}).check(
  Schema.makeFilter((navigation) =>
    navigation.folders.some((folder) => folder.kind === "inbox")
      ? undefined
      : "mailbox navigation must contain an inbox folder"
  )
);
export type MailboxNavigationResult = Schema.Schema.Type<
  typeof MailboxNavigationResult
>;

export class MailboxNavigationError extends Data.TaggedError(
  "MailboxNavigationError"
)<{
  readonly cause?: unknown;
  readonly message: string;
  readonly reason: "not-found" | "storage";
}> {}

export interface MailboxNavigationService {
  readonly getCurrent: Effect.Effect<
    MailboxNavigationResult,
    MailboxAuthorizationError | MailboxNavigationError,
    CurrentActor | CurrentPrincipal
  >;
}

/** Current mailbox discovery and authorized directory navigation. */
export class MailboxNavigation extends Context.Service<
  MailboxNavigation,
  MailboxNavigationService
>()("cloudflare-inbox/MailboxNavigation", {
  make: Effect.gen(function* () {
    return yield* MailboxNavigationReader;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
