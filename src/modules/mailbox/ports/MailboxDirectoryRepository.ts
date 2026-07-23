import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  CreateFolderInput,
  CreateLabelInput,
  DeleteFolderInput,
  DeleteFolderResult,
  DeleteLabelInput,
  DeleteLabelResult,
  Folder,
  FolderList,
  Label,
  LabelList,
  ListFoldersInput,
  ListLabelsInput,
  RenameFolderInput,
  RenameLabelInput,
} from "#/modules/mailbox/domain/MailboxDirectory";
import type { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import type { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";

export interface MailboxDirectoryRepositoryService {
  readonly createFolder: (
    input: CreateFolderInput
  ) => Effect.Effect<Folder, MailboxDomainError | MailboxRepositoryError>;
  readonly createLabel: (
    input: CreateLabelInput
  ) => Effect.Effect<Label, MailboxDomainError | MailboxRepositoryError>;
  readonly deleteFolder: (
    input: DeleteFolderInput
  ) => Effect.Effect<
    DeleteFolderResult,
    MailboxDomainError | MailboxRepositoryError
  >;
  readonly deleteLabel: (
    input: DeleteLabelInput
  ) => Effect.Effect<
    DeleteLabelResult,
    MailboxDomainError | MailboxRepositoryError
  >;
  readonly listFolders: (
    input: ListFoldersInput
  ) => Effect.Effect<FolderList, MailboxDomainError | MailboxRepositoryError>;
  readonly listLabels: (
    input: ListLabelsInput
  ) => Effect.Effect<LabelList, MailboxDomainError | MailboxRepositoryError>;
  readonly renameFolder: (
    input: RenameFolderInput
  ) => Effect.Effect<Folder, MailboxDomainError | MailboxRepositoryError>;
  readonly renameLabel: (
    input: RenameLabelInput
  ) => Effect.Effect<Label, MailboxDomainError | MailboxRepositoryError>;
}

/** Directory persistence capability required by mailbox application services. */
export class MailboxDirectoryRepository extends Context.Service<
  MailboxDirectoryRepository,
  MailboxDirectoryRepositoryService
>()("cloudflare-inbox/MailboxDirectoryRepository") {}
