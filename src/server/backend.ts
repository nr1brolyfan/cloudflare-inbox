import { getRequest } from "@tanstack/react-start/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import type { MailboxInlineAttachmentInput } from "../mailboxes/attachment-reading";
import type {
  CreateMailboxDraftCommand,
  GetMailboxDraftQuery,
  UpdateMailboxDraftCommand,
} from "../mailboxes/draft-editing";
import type { MailboxMessageActionCommand } from "../mailboxes/message-actions";
import type { MailboxMessageHtmlInput } from "../mailboxes/message-html";
import type {
  MailboxMessageListInput,
  OpenMailboxThreadInput,
} from "../mailboxes/message-reading";
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
  bootstrapMailboxOwner: (displayName: string) =>
    websiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.bootstrapOwner({ displayName, incoming });
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
  renameMailbox: (input: {
    readonly displayName: string;
    readonly mailboxId: string;
  }) =>
    websiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.rename({ ...input, incoming });
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
} as const;
