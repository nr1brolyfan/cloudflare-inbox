import { getRequest, getResponseHeaders } from "@tanstack/react-start/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import type {
  CreateMailboxDraftCommand,
  GetMailboxDraftQuery,
  UpdateMailboxDraftCommand,
} from "#/modules/mailbox/application/MailboxDraftEditing";
import type { MailboxDraftListInput } from "#/modules/mailbox/application/MailboxDraftReading";
import type { MailboxInboundAttachmentInput } from "#/modules/mailbox/application/MailboxInboundAttachmentReading";
import type { MailboxInlineAttachmentInput } from "#/modules/mailbox/application/MailboxInlineAttachmentReading";
import type {
  MailboxMessageActionCommand,
  MailboxMessageBatchActionCommand,
  SetMailboxThreadReadCommand,
} from "#/modules/mailbox/application/MailboxMessageActions";
import type { MailboxMessageHtmlInput } from "#/modules/mailbox/application/MailboxMessageHtmlReading";
import type {
  MailboxMessageListInput,
  OpenMailboxThreadInput,
} from "#/modules/mailbox/application/MailboxMessageReading";
import type { GetMailboxOutboundDeliveryQuery } from "#/modules/mailbox/application/MailboxOutboundDeliveryReading";
import type {
  SendMailboxDraftCommand,
  UndoMailboxSendCommand,
} from "#/modules/mailbox/application/MailboxOutboundSending";
import type { CreateMailboxReplyDraftCommand } from "#/modules/mailbox/application/MailboxReplyDraftCreation";
import type { SearchContactsInput } from "#/modules/mailbox/domain/MailboxContact";
import type {
  ReserveDraftAttachmentCommand,
  UploadDraftAttachmentCommand,
} from "#/modules/mailbox/domain/MailboxDraftAttachment";
import type {
  ReadMailboxAdministrationOperationQuery,
  RenameMailboxCommand,
} from "#/modules/organization/application/MailboxAdministration";
import type { BootstrapOrganizationCommand } from "#/modules/organization/application/OrganizationBootstrap";
import type {
  GetMailboxContactPreferenceQuery,
  UpdateMailboxContactPreferenceCommand,
} from "#/modules/organization/application/UserMailboxContactPreferences";

import {
  DevEmailOperations,
  DevEmailOperationsLayer,
} from "./DevEmailOperations";
import {
  MailboxBackendOperations,
  MailboxBackendOperationsLayer,
} from "./MailboxBackendOperations";
import { BackendClient, WebsitePlatformLayer } from "./WebsitePlatform";

/** Complete Website-side service graph, built once without request-bound state. */
export const WebsiteApplicationLayer = Layer.merge(
  MailboxBackendOperationsLayer,
  DevEmailOperationsLayer
).pipe(Layer.provideMerge(WebsitePlatformLayer));

const WebsiteRuntime = ManagedRuntime.make(WebsiteApplicationLayer);

export const setMailboxOperationReceiptNoStoreHeaders = () => {
  const headers = getResponseHeaders();
  headers.set("cache-control", "private, no-store");
  headers.set("pragma", "no-cache");
};

/** Promise facade used by TanStack adapters; all Effect execution stays here. */
export const WebsiteApplication = {
  setMailboxThreadRead: (command: SetMailboxThreadReadCommand) =>
    WebsiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.setThreadRead({ command, incoming });
      })
    ),
  actOnMailboxMessages: (command: MailboxMessageBatchActionCommand) =>
    WebsiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.actOnMessages({ command, incoming });
      })
    ),
  actOnMailboxMessage: (command: MailboxMessageActionCommand) =>
    WebsiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.actOnMessage({ command, incoming });
      })
    ),
  bootstrapMailboxOwner: (command: BootstrapOrganizationCommand) =>
    WebsiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.bootstrapOwner({ command, incoming });
      })
    ),
  createMailboxDraft: (command: CreateMailboxDraftCommand) =>
    WebsiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.createDraft({ command, incoming });
      })
    ),
  createMailboxReplyDraft: (command: CreateMailboxReplyDraftCommand) =>
    WebsiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.createReplyDraft({ command, incoming });
      })
    ),
  clearDevEmails: () =>
    WebsiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* DevEmailOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.clear(incoming);
      })
    ),
  forward: (operation: string, request: Request) =>
    WebsiteRuntime.runPromise(
      BackendClient.pipe(
        Effect.flatMap((backend) => backend.fetch(operation, request))
      )
    ),
  getDevEmailInboxStatus: () =>
    WebsiteRuntime.runPromise(
      DevEmailOperations.pipe(Effect.flatMap((operations) => operations.status))
    ),
  getMailboxNavigation: () =>
    WebsiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.getNavigation(incoming);
      })
    ),
  readMailboxAdministrationOperation: (
    query: ReadMailboxAdministrationOperationQuery
  ) => {
    setMailboxOperationReceiptNoStoreHeaders();
    return WebsiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.readOperation({ incoming, query });
      })
    );
  },
  getMailboxOutboundDelivery: (query: GetMailboxOutboundDeliveryQuery) =>
    WebsiteRuntime.runPromise(
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
    WebsiteRuntime.runPromise(
      MailboxBackendOperations.pipe(
        Effect.flatMap((operations) =>
          operations.getInlineAttachment({ incoming, query })
        )
      )
    ),
  getMailboxInboundAttachment: (
    query: MailboxInboundAttachmentInput,
    incoming: Request
  ) =>
    WebsiteRuntime.runPromise(
      MailboxBackendOperations.pipe(
        Effect.flatMap((operations) =>
          operations.getInboundAttachment({ incoming, query })
        )
      )
    ),
  getMailboxDraft: (query: GetMailboxDraftQuery) =>
    WebsiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.getDraft({ incoming, query });
      })
    ),
  getMailboxContactPreferences: (query: GetMailboxContactPreferenceQuery) =>
    WebsiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.getContactPreferences({ incoming, query });
      })
    ),
  getMailboxMessageHtml: (query: MailboxMessageHtmlInput, incoming: Request) =>
    WebsiteRuntime.runPromise(
      MailboxBackendOperations.pipe(
        Effect.flatMap((operations) =>
          operations.getMessageHtml({ incoming, query })
        )
      )
    ),
  getMailboxThread: (query: OpenMailboxThreadInput) =>
    WebsiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.getThread({ incoming, query });
      })
    ),
  listDevEmails: () =>
    WebsiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* DevEmailOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.list(incoming);
      })
    ),
  listMailboxMessages: (query: MailboxMessageListInput) =>
    WebsiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.listMessages({ incoming, query });
      })
    ),
  searchMailboxContacts: (query: SearchContactsInput) =>
    WebsiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.searchContacts({ incoming, query });
      })
    ),
  listMailboxDrafts: (query: MailboxDraftListInput) =>
    WebsiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.listDrafts({ incoming, query });
      })
    ),
  renameMailbox: (command: RenameMailboxCommand) =>
    WebsiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.rename({ command, incoming });
      })
    ),
  reserveMailboxDraftAttachment: (command: ReserveDraftAttachmentCommand) =>
    WebsiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.reserveDraftAttachment({ command, incoming });
      })
    ),
  sendMailboxDraft: (command: SendMailboxDraftCommand) =>
    WebsiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.sendDraft({ command, incoming });
      })
    ),
  updateMailboxDraft: (command: UpdateMailboxDraftCommand) =>
    WebsiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.updateDraft({ command, incoming });
      })
    ),
  updateMailboxContactPreferences: (
    command: UpdateMailboxContactPreferenceCommand
  ) =>
    WebsiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.updateContactPreferences({
          command,
          incoming,
        });
      })
    ),
  undoMailboxSend: (command: UndoMailboxSendCommand) =>
    WebsiteRuntime.runPromise(
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
    WebsiteRuntime.runPromise(
      MailboxBackendOperations.pipe(
        Effect.flatMap((operations) =>
          operations.uploadDraftAttachment({ ...input, incoming })
        )
      )
    ),
} as const;
