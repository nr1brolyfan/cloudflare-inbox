import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { MailboxRepository } from "#/mailboxes/repository";
import { MailboxDirectoryRepository } from "#/modules/mailbox/ports/MailboxDirectoryRepository";
import { MailboxMessageRepository } from "#/modules/mailbox/ports/MailboxMessageRepository";

/** Incremental projections over the existing aggregate DO transport adapter. */
export const MailboxMessageRepositoryDoLayer = Layer.effect(
  MailboxMessageRepository,
  Effect.gen(function* () {
    const repository = yield* MailboxRepository;
    return MailboxMessageRepository.of({
      getMessage: repository.getMessage,
      getThread: repository.getThread,
      listMessages: repository.listMessages,
      moveMessage: repository.moveMessage,
      searchMessages: repository.searchMessages,
      setMessageRead: repository.setMessageRead,
      setMessageStarred: repository.setMessageStarred,
    });
  })
);

export const MailboxDirectoryRepositoryDoLayer = Layer.effect(
  MailboxDirectoryRepository,
  Effect.gen(function* () {
    const repository = yield* MailboxRepository;
    return MailboxDirectoryRepository.of({
      listFolders: repository.listFolders,
    });
  })
);
