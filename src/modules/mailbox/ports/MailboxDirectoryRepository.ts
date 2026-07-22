import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { FolderList, ListFoldersInput } from "#/mailboxes/directory";
import type {
  MailboxDomainError,
  MailboxRepositoryError,
} from "#/mailboxes/errors";

export interface MailboxDirectoryRepositoryService {
  readonly listFolders: (
    input: ListFoldersInput
  ) => Effect.Effect<FolderList, MailboxDomainError | MailboxRepositoryError>;
}

/** Directory persistence capability required by mailbox application services. */
export class MailboxDirectoryRepository extends Context.Service<
  MailboxDirectoryRepository,
  MailboxDirectoryRepositoryService
>()("cloudflare-inbox/MailboxDirectoryRepository") {}
