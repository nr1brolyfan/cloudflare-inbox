import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  FolderList,
  LabelList,
  ListFoldersInput,
  ListLabelsInput,
} from "#/modules/mailbox/domain/MailboxDirectory";
import type { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import type { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";

export interface MailboxDirectoryRepositoryService {
  readonly listFolders: (
    input: ListFoldersInput
  ) => Effect.Effect<FolderList, MailboxDomainError | MailboxRepositoryError>;
  readonly listLabels: (
    input: ListLabelsInput
  ) => Effect.Effect<LabelList, MailboxDomainError | MailboxRepositoryError>;
}

/** Directory persistence capability required by mailbox application services. */
export class MailboxDirectoryRepository extends Context.Service<
  MailboxDirectoryRepository,
  MailboxDirectoryRepositoryService
>()("cloudflare-inbox/MailboxDirectoryRepository") {}
