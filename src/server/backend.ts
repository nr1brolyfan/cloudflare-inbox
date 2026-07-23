import { getRequest } from "@tanstack/react-start/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import type {
  CreateMailboxDraftCommand,
  GetMailboxDraftQuery,
  UpdateMailboxDraftCommand,
} from "#/modules/mailbox/application/MailboxDraftEditing";
import type { MailboxDraftListInput } from "#/modules/mailbox/application/MailboxDraftReading";
import type { MailboxInlineAttachmentInput } from "#/modules/mailbox/application/MailboxInlineAttachmentReading";
import type { MailboxMessageActionCommand } from "#/modules/mailbox/application/MailboxMessageActions";
import type { MailboxMessageHtmlInput } from "#/modules/mailbox/application/MailboxMessageHtmlReading";
import type {
  MailboxMessageListInput,
  OpenMailboxThreadInput,
} from "#/modules/mailbox/application/MailboxMessageReading";
import type {
  ReserveDraftAttachmentCommand,
  UploadDraftAttachmentCommand,
} from "#/modules/mailbox/domain/MailboxDraftAttachment";

import type {
  BootstrapOwnerMailboxCommand,
  RenameMailboxCommand,
} from "../mailboxes/administration";
import type { GetMailboxOutboundDeliveryQuery } from "../mailboxes/outbound-delivery-reading";
import type {
  SendMailboxDraftCommand,
  UndoMailboxSendCommand,
} from "../mailboxes/outbound-sending";
import {
  DevEmailOperations,
  DevEmailOperationsLive,
} from "./dev-email-backend";
import {
  MailboxBackendOperations,
  MailboxBackendOperationsLive,
} from "./mailbox-backend";
import { BackendClient, WebsitePlatformServicesLive } from "./website-platform";

/** Complete Website-side service graph, built once without request-bound state. */
export const WebsiteLive = Layer.merge(
  MailboxBackendOperationsLive,
  DevEmailOperationsLive
).pipe(Layer.provideMerge(WebsitePlatformServicesLive));

const websiteRuntime = ManagedRuntime.make(WebsiteLive);

/** Promise facade used by TanStack adapters; all Effect execution stays here. */
export const websiteBackend = {
  actOnMailboxMessage: (command: MailboxMessageActionCommand) =>
    websiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.actOnMessage({ command, incoming });
      })
    ),
  bootstrapMailboxOwner: (command: BootstrapOwnerMailboxCommand) =>
    websiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.bootstrapOwner({ command, incoming });
      })
    ),
  createMailboxDraft: (command: CreateMailboxDraftCommand) =>
    websiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.createDraft({ command, incoming });
      })
    ),
  clearDevEmails: () =>
    websiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* DevEmailOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.clear(incoming);
      })
    ),
  forward: (operation: string, request: Request) =>
    websiteRuntime.runPromise(
      BackendClient.pipe(
        Effect.flatMap((backend) => backend.fetch(operation, request))
      )
    ),
  getDevEmailInboxStatus: () =>
    websiteRuntime.runPromise(
      DevEmailOperations.pipe(Effect.flatMap((operations) => operations.status))
    ),
  getMailboxNavigation: () =>
    websiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.getNavigation(incoming);
      })
    ),
  getMailboxOutboundDelivery: (query: GetMailboxOutboundDeliveryQuery) =>
    websiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.getOutboundDelivery({ incoming, query });
      })
    ),
  getMailboxInlineAttachment: (
    query: MailboxInlineAttachmentInput,
    incoming: Request
  ) =>
    websiteRuntime.runPromise(
      MailboxBackendOperations.pipe(
        Effect.flatMap((operations) =>
          operations.getInlineAttachment({ incoming, query })
        )
      )
    ),
  getMailboxDraft: (query: GetMailboxDraftQuery) =>
    websiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.getDraft({ incoming, query });
      })
    ),
  getMailboxMessageHtml: (query: MailboxMessageHtmlInput, incoming: Request) =>
    websiteRuntime.runPromise(
      MailboxBackendOperations.pipe(
        Effect.flatMap((operations) =>
          operations.getMessageHtml({ incoming, query })
        )
      )
    ),
  getMailboxThread: (query: OpenMailboxThreadInput) =>
    websiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.getThread({ incoming, query });
      })
    ),
  listDevEmails: () =>
    websiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* DevEmailOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.list(incoming);
      })
    ),
  listMailboxMessages: (query: MailboxMessageListInput) =>
    websiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.listMessages({ incoming, query });
      })
    ),
  listMailboxDrafts: (query: MailboxDraftListInput) =>
    websiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.listDrafts({ incoming, query });
      })
    ),
  renameMailbox: (command: RenameMailboxCommand) =>
    websiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.rename({ command, incoming });
      })
    ),
  reserveMailboxDraftAttachment: (command: ReserveDraftAttachmentCommand) =>
    websiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.reserveDraftAttachment({ command, incoming });
      })
    ),
  sendMailboxDraft: (command: SendMailboxDraftCommand) =>
    websiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.sendDraft({ command, incoming });
      })
    ),
  updateMailboxDraft: (command: UpdateMailboxDraftCommand) =>
    websiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.updateDraft({ command, incoming });
      })
    ),
  undoMailboxSend: (command: UndoMailboxSendCommand) =>
    websiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.undoSend({ command, incoming });
      })
    ),
  uploadMailboxDraftAttachment: (
    input: Omit<UploadDraftAttachmentCommand, "content">,
    incoming: Request
  ) =>
    websiteRuntime.runPromise(
      MailboxBackendOperations.pipe(
        Effect.flatMap((operations) =>
          operations.uploadDraftAttachment({ ...input, incoming })
        )
      )
    ),
} as const;
