import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { MailboxRepository } from "#/mailboxes/repository";
import { MailboxDirectoryRepository } from "#/modules/mailbox/ports/MailboxDirectoryRepository";
import { MailboxDraftRepository } from "#/modules/mailbox/ports/MailboxDraftRepository";
import { MailboxMessageRepository } from "#/modules/mailbox/ports/MailboxMessageRepository";
import { MailboxOutboundDeliveryRepository } from "#/modules/mailbox/ports/MailboxOutboundDeliveryRepository";
import { MailboxOutboundSendingRepository } from "#/modules/mailbox/ports/MailboxOutboundSendingRepository";

/** Incremental projections over the existing aggregate DO transport adapter. */
export const MailboxMessageRepositoryDoLayer = Layer.effect(
  MailboxMessageRepository,
  Effect.gen(function* () {
    const repository = yield* MailboxRepository;
    return MailboxMessageRepository.of({
      getAttachmentBlob: repository.getAttachmentBlob,
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
      listLabels: repository.listLabels,
    });
  })
);

export const MailboxDraftRepositoryDoLayer = Layer.effect(
  MailboxDraftRepository,
  Effect.gen(function* () {
    const repository = yield* MailboxRepository;
    return MailboxDraftRepository.of({
      completeDraftAttachment: repository.completeDraftAttachment,
      createDraft: repository.createDraft,
      getDraft: repository.getDraft,
      getDraftAttachment: repository.getDraftAttachment,
      listDraftAttachments: repository.listDraftAttachments,
      listDrafts: repository.listDrafts,
      reserveDraftAttachment: repository.reserveDraftAttachment,
      updateDraft: repository.updateDraft,
    });
  })
);

export const MailboxOutboundDeliveryRepositoryDoLayer = Layer.effect(
  MailboxOutboundDeliveryRepository,
  Effect.gen(function* () {
    const repository = yield* MailboxRepository;
    return MailboxOutboundDeliveryRepository.of({
      getOutboundDelivery: repository.getOutboundDelivery,
    });
  })
);

export const MailboxOutboundSendingRepositoryDoLayer = Layer.effect(
  MailboxOutboundSendingRepository,
  Effect.gen(function* () {
    const repository = yield* MailboxRepository;
    return MailboxOutboundSendingRepository.of({
      cancelOutboundDelivery: repository.cancelOutboundDelivery,
      scheduleOutbound: repository.scheduleOutbound,
    });
  })
);
