/* oxlint-disable vitest/max-expects -- HTTP integration cases verify binding, provenance, response, and privacy outcomes together. */
import { AuthSecretsLive } from "@effect-auth/core/AuthConfig";
import { WebCryptoLive } from "@effect-auth/core/Crypto";
import {
  AuthOriginCheckMiddlewareLive,
  AuthSchemaErrorMiddlewareLive,
} from "@effect-auth/core/HttpApi";
import {
  SessionId,
  SessionToken,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import * as AuthPolicy from "@effect-auth/core/Policy";
import type {
  SessionClaims,
  SessionsService,
  ValidatedSession,
} from "@effect-auth/core/Sessions";
import {
  makeSessionCookie,
  SessionCookie,
  SessionValidateError,
  Sessions,
} from "@effect-auth/core/Sessions";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi";
import { describe, expect, it } from "vitest";

import { MailboxGroup } from "#/apps/backend-worker/BackendMailboxHttpApi";
import { MailboxHttpHandlersLayer } from "#/apps/backend-worker/BackendMailboxHttpHandlers";
import {
  MailboxOperation,
  MailboxSessionRequirementsMiddlewareLayer,
} from "#/apps/backend-worker/MailboxSessionRequirements";
import type { MailboxOperation as MailboxOperationName } from "#/apps/backend-worker/MailboxSessionRequirements";
import {
  RequestSessionAuthenticatorEffectAuthLayer,
  SessionAuthenticationMiddlewareLayer,
} from "#/modules/account-security/adapters/http/RequestSessionAuthentication";
import { MailboxDoClient } from "#/modules/mailbox/adapters/durable-object/MailboxDoClient";
import { MailboxDraftAttachments } from "#/modules/mailbox/application/MailboxDraftAttachments";
import type { MailboxDraftAttachmentsService } from "#/modules/mailbox/application/MailboxDraftAttachments";
import {
  DraftEditorDraft,
  MailboxDraftEditing,
} from "#/modules/mailbox/application/MailboxDraftEditing";
import type { MailboxDraftEditingService } from "#/modules/mailbox/application/MailboxDraftEditing";
import {
  MailboxDraftListResult,
  MailboxDraftReading,
} from "#/modules/mailbox/application/MailboxDraftReading";
import type { MailboxDraftReadingService } from "#/modules/mailbox/application/MailboxDraftReading";
import { MailboxInboundAttachmentReading } from "#/modules/mailbox/application/MailboxInboundAttachmentReading";
import type { MailboxInboundAttachmentReadingService } from "#/modules/mailbox/application/MailboxInboundAttachmentReading";
import {
  MailboxInboundReplay,
  MailboxInboundReplayAuthorization,
} from "#/modules/mailbox/application/MailboxInboundReplay";
import type { MailboxInboundReplayService } from "#/modules/mailbox/application/MailboxInboundReplay";
import { MailboxInlineAttachmentReading } from "#/modules/mailbox/application/MailboxInlineAttachmentReading";
import type { MailboxInlineAttachmentReadingService } from "#/modules/mailbox/application/MailboxInlineAttachmentReading";
import {
  MailboxMessageActionResult,
  MailboxMessageActions,
} from "#/modules/mailbox/application/MailboxMessageActions";
import type { MailboxMessageActionsService } from "#/modules/mailbox/application/MailboxMessageActions";
import {
  MailboxMessageHtmlReading,
  MailboxMessageHtmlResult,
} from "#/modules/mailbox/application/MailboxMessageHtmlReading";
import type { MailboxMessageHtmlReadingService } from "#/modules/mailbox/application/MailboxMessageHtmlReading";
import {
  MailboxMessageListResult,
  MailboxMessageReading,
  MailboxMessageReadingError,
  MailboxThreadResult,
} from "#/modules/mailbox/application/MailboxMessageReading";
import type { MailboxMessageReadingService } from "#/modules/mailbox/application/MailboxMessageReading";
import {
  GetMailboxOutboundDeliveryResult,
  MailboxOutboundDeliveryReading,
} from "#/modules/mailbox/application/MailboxOutboundDeliveryReading";
import type { MailboxOutboundDeliveryReadingService } from "#/modules/mailbox/application/MailboxOutboundDeliveryReading";
import {
  MailboxOutboundSending,
  MailboxOutboundSendingError,
  SendMailboxDraftResult,
} from "#/modules/mailbox/application/MailboxOutboundSending";
import type { MailboxOutboundSendingService } from "#/modules/mailbox/application/MailboxOutboundSending";
import {
  MailboxReplyDraftCreation,
  MailboxReplyDraftCreationError,
} from "#/modules/mailbox/application/MailboxReplyDraftCreation";
import type { MailboxReplyDraftCreationService } from "#/modules/mailbox/application/MailboxReplyDraftCreation";
import { MimeType } from "#/modules/mailbox/domain/Mailbox";
import {
  DraftAttachmentReservationSchema,
  DraftAttachmentUploadResult,
} from "#/modules/mailbox/domain/MailboxDraftAttachment";
import { InboundProcessingSchema } from "#/modules/mailbox/domain/MailboxInbound";
import { OutboundDeliverySchema } from "#/modules/mailbox/domain/MailboxOutbound";
import {
  MailboxAuthorization,
  MailResourceResolveError,
} from "#/modules/mailbox/ports/MailboxAuthorization";
import type { MailboxAuthorizationService } from "#/modules/mailbox/ports/MailboxAuthorization";
import { CurrentMailboxOperationProvenance } from "#/modules/mailbox/ports/MailboxOperationProvenance";
import type { MailboxAdministrationService } from "#/modules/organization/application/MailboxAdministration";
import {
  MailboxAdministration,
  MailboxAdministrationError,
  MailboxAdministrationReceipt,
} from "#/modules/organization/application/MailboxAdministration";
import {
  MailboxNavigation,
  MailboxNavigationError,
  MailboxNavigationResult,
} from "#/modules/organization/application/MailboxNavigation";
import type { MailboxNavigationService } from "#/modules/organization/application/MailboxNavigation";
import type { OrganizationBootstrapService } from "#/modules/organization/application/OrganizationBootstrap";
import {
  OrganizationBootstrap,
  OrganizationBootstrapError,
} from "#/modules/organization/application/OrganizationBootstrap";
import type { UserMailboxContactPreferencesService } from "#/modules/organization/application/UserMailboxContactPreferences";
import {
  MailboxContactPreference,
  UserMailboxContactPreferences,
} from "#/modules/organization/application/UserMailboxContactPreferences";
import { MailboxRecordSchema } from "#/modules/organization/domain/Mailbox";
import { HttpApiPlatformLayer } from "#/platform/cloudflare/HttpApiPlatform";
import {
  backendRequestContext,
  CurrentBackendRequestContext,
} from "#/platform/observability/BackendRequestContext";
import { BackendRequestContextMiddlewareLayer } from "#/platform/observability/BackendRequestContextMiddlewareLayer";

const publicOrigin = "https://inbox.test";
const MailboxTestApi = HttpApi.make("AuthApi").add(MailboxGroup);
const userId = UserId("user-a");
const sessionId = SessionId("session-a");
const contactPreference = Schema.decodeUnknownSync(MailboxContactPreference)({
  allParticipantsEnabledAt: null,
  mailboxId: "mailbox-a",
  version: 0,
  visibility: "safe",
});
const sessionToken = SessionToken(`${sessionId}.secret`);
const validatedSession = {
  actor: { sessionId, userId },
  currentSession: {
    aal: "aal1",
    amr: [],
    authenticationEvents: [],
    authTime: UnixMillis(1000),
    expiresAt: UnixMillis(10_000),
    sessionId,
    userId,
  },
  issued: {
    aal: "aal1",
    amr: [],
    authenticationEvents: [],
    authTime: UnixMillis(1000),
    expiresAt: UnixMillis(10_000),
    sessionId,
    token: sessionToken,
    userId,
  },
} satisfies ValidatedSession;
const mailbox = Schema.decodeUnknownSync(MailboxRecordSchema)({
  createdAt: 1000,
  createdByUserId: userId,
  displayName: "Inbox",
  id: "primary",
  status: "active",
  updatedAt: 1000,
  version: 1,
});
const mailboxAdministrationReceipt = Schema.decodeUnknownSync(
  MailboxAdministrationReceipt
)({
  actorUserId: userId,
  committedAt: 1000,
  displayName: "Inbox",
  mailboxId: "primary",
  operationId: "00000000-0000-4000-8000-000000000010",
  operationKind: "bootstrap-owner",
  result: mailbox,
  schemaVersion: 1,
});
const replayedProcessing = Schema.decodeUnknownSync(InboundProcessingSchema)({
  attemptCount: 2,
  createdAt: 1000,
  id: "ingest-1",
  mailboxId: "primary",
  status: "received",
  updatedAt: 2000,
  version: 3,
});
const mailboxNavigation = Schema.decodeUnknownSync(MailboxNavigationResult)({
  mailbox: {
    displayName: "Inbox",
    id: "primary",
    primaryAddress: "inbox@example.com",
  },
  folders: [
    {
      id: "inbox",
      kind: "inbox",
      messageCount: 4,
      name: "Inbox",
      unreadCount: 2,
    },
  ],
  labels: [],
});
const mailboxMessages = Schema.decodeUnknownSync(MailboxMessageListResult)({
  items: [
    {
      activityAt: 2000,
      direction: "inbound",
      folderId: "inbox",
      hasAttachments: false,
      id: "message-1",
      read: false,
      recipients: [{ address: "owner@example.test" }],
      sender: { address: "sender@example.test", displayName: "Sender" },
      snippet: "Plain text preview",
      starred: false,
      subject: "Hello",
      threadId: "thread-1",
      version: 1,
    },
  ],
});
const mailboxMessageAction = Schema.decodeUnknownSync(
  MailboxMessageActionResult
)({
  folderId: "inbox",
  id: "message-1",
  read: true,
  starred: false,
  version: 2,
});
const mailboxThread = Schema.decodeUnknownSync(MailboxThreadResult)({
  hasMore: false,
  messages: [
    {
      activityAt: 2000,
      attachments: [],
      cc: [],
      direction: "inbound",
      hasHtmlBody: true,
      id: "message-1",
      read: false,
      replyEligible: true,
      sender: { address: "sender@example.test", displayName: "Sender" },
      textBody: "Plain text body",
      to: [{ address: "owner@example.test" }],
    },
  ],
  thread: {
    id: "thread-1",
    latestActivityAt: 2000,
    messageCount: 1,
    subject: "Hello",
    unreadCount: 1,
  },
});
const mailboxMessageHtml = Schema.decodeUnknownSync(MailboxMessageHtmlResult)({
  _tag: "Folder",
  document: "<html><body><p>Hello</p></body></html>",
  folderId: "inbox",
  mailboxId: "primary",
  messageId: "message-1",
});
const mailboxDraft = Schema.decodeUnknownSync(DraftEditorDraft)({
  attachments: [],
  id: "draft-1",
  mailboxId: "primary",
  content: { bcc: [], cc: [], subject: "Draft", to: [] },
  createdAt: 1000,
  updatedAt: 1000,
  version: 1,
});
const mailboxDrafts = Schema.decodeUnknownSync(MailboxDraftListResult)({
  items: [
    {
      hasAttachments: true,
      id: "draft-1",
      mailboxId: "primary",
      recipients: [{ address: "recipient@example.test" }],
      snippet: "Draft preview",
      subject: "Draft",
      updatedAt: 2000,
      version: 2,
    },
  ],
  nextCursor: "next-drafts",
});
const draftAttachment = Schema.decodeUnknownSync(
  DraftAttachmentReservationSchema
)({
  createdAt: 1000,
  draftId: "draft-1",
  expiresAt: 901_000,
  fileName: "brief.pdf",
  id: "attachment-1",
  mailboxId: "primary",
  mimeType: "application/pdf",
  size: 3,
  status: "reserved",
});
const draftAttachmentUpload = Schema.decodeUnknownSync(
  DraftAttachmentUploadResult
)({
  attachment: {
    ...draftAttachment,
    contentSha256: "a".repeat(64),
    status: "stored",
    storedAt: 2000,
  },
  draftVersion: 2,
});
const scheduledDelivery = Schema.decodeUnknownSync(OutboundDeliverySchema)({
  attemptCount: 0,
  createdAt: 1000,
  id: "delivery-1",
  mailboxId: "primary",
  messageId: "message-outbound-1",
  sendAt: 11_000,
  status: "scheduled",
  updatedAt: 1000,
  version: 1,
});
const mailboxDraftSend = Schema.decodeUnknownSync(SendMailboxDraftResult)({
  delivery: scheduledDelivery,
  serverNow: 1000,
});
const mailboxOutboundDelivery = Schema.decodeUnknownSync(
  GetMailboxOutboundDeliveryResult
)({ delivery: scheduledDelivery, serverNow: 2000 });
const cancelledDelivery = Schema.decodeUnknownSync(OutboundDeliverySchema)({
  ...scheduledDelivery,
  cancelledAt: 2000,
  status: "cancelled",
  updatedAt: 2000,
  version: 2,
});

interface TestAdministrationOverrides extends Partial<MailboxAdministrationService> {
  readonly bootstrapOwner?: OrganizationBootstrapService["bootstrap"];
}

const bootstrapByAdministration = new WeakMap<
  MailboxAdministrationService,
  OrganizationBootstrapService
>();

const makeAdministration = (overrides: TestAdministrationOverrides = {}) => {
  const { bootstrapOwner, ...administrationOverrides } = overrides;
  const administration = MailboxAdministration.of({
    readOperation: () => Effect.succeed(mailboxAdministrationReceipt),
    rename: ({ displayName }) =>
      Effect.succeed(
        Schema.decodeUnknownSync(MailboxRecordSchema)({
          ...mailbox,
          displayName,
          version: 2,
        })
      ),
    ...administrationOverrides,
  });
  bootstrapByAdministration.set(
    administration,
    OrganizationBootstrap.of({
      bootstrap: bootstrapOwner ?? (() => Effect.succeed(mailbox)),
    })
  );
  return administration;
};

const makeHandler = (
  administration: MailboxAdministrationService,
  validate: SessionsService["validate"] = () =>
    Effect.succeed(validatedSession),
  navigation: MailboxNavigationService = MailboxNavigation.of({
    getCurrent: Effect.succeed(mailboxNavigation),
  }),
  messageReading: MailboxMessageReadingService = MailboxMessageReading.of({
    listView: () => Effect.succeed(mailboxMessages),
    openThread: () => Effect.succeed(mailboxThread),
    readMessage: () => Effect.die("Unexpected message read"),
  }),
  messageActions: MailboxMessageActionsService = MailboxMessageActions.of({
    executeBatch: () => Effect.die("Unexpected batch message action"),
    execute: () => Effect.succeed(mailboxMessageAction),
    setThreadRead: () => Effect.die("Unexpected thread read action"),
  }),
  messageHtml: MailboxMessageHtmlReadingService = MailboxMessageHtmlReading.of({
    get: () => Effect.succeed(mailboxMessageHtml),
  }),
  inlineAttachments: MailboxInlineAttachmentReadingService = MailboxInlineAttachmentReading.of(
    {
      get: () =>
        Effect.succeed({
          bytes: new Uint8Array([1, 2, 3]),
          mimeType: Schema.decodeUnknownSync(MimeType)("image/png"),
        }),
    }
  ),
  draftEditing: MailboxDraftEditingService = MailboxDraftEditing.of({
    create: () => Effect.succeed(mailboxDraft),
    get: () => Effect.succeed(mailboxDraft),
    update: () => Effect.succeed(mailboxDraft),
  }),
  draftAttachments: MailboxDraftAttachmentsService = MailboxDraftAttachments.of(
    {
      reserve: () => Effect.succeed(draftAttachment),
      upload: () => Effect.succeed(draftAttachmentUpload),
    }
  ),
  outboundSending: MailboxOutboundSendingService = MailboxOutboundSending.of({
    send: () => Effect.succeed(mailboxDraftSend),
    undo: () => Effect.succeed(cancelledDelivery),
  }),
  outboundDeliveryReading: MailboxOutboundDeliveryReadingService = MailboxOutboundDeliveryReading.of(
    {
      get: () => Effect.succeed(mailboxOutboundDelivery),
    }
  ),
  draftReading: MailboxDraftReadingService = MailboxDraftReading.of({
    list: () => Effect.succeed(mailboxDrafts),
  }),
  inboundReplay: MailboxInboundReplayService = MailboxInboundReplay.of({
    replay: () => Effect.succeed(replayedProcessing),
  }),
  inboundAttachments: MailboxInboundAttachmentReadingService = MailboxInboundAttachmentReading.of(
    {
      get: () =>
        Effect.succeed({
          bytes: new Uint8Array([1, 2, 3]),
          fileName: "brief.pdf",
          mimeType: Schema.decodeUnknownSync(MimeType)("application/pdf"),
        }),
    }
  ),
  replyDraftCreation: MailboxReplyDraftCreationService = MailboxReplyDraftCreation.of(
    {
      create: () => Effect.succeed(mailboxDraft),
    }
  ),
  contactPreferences: UserMailboxContactPreferencesService = UserMailboxContactPreferences.of(
    {
      get: () => Effect.succeed(contactPreference),
      update: () => Effect.succeed(contactPreference),
    }
  )
) => {
  const requestAuthLive = Layer.mergeAll(
    Layer.effect(SessionCookie, makeSessionCookie()),
    Layer.succeed(Sessions, Sessions.of({ validate } as SessionsService)),
    WebCryptoLive(),
    AuthSecretsLive({
      challenge: Redacted.make("challenge-secret".repeat(3)),
      privacy: Redacted.make("privacy-secret".repeat(3)),
      session: Redacted.make("session-secret".repeat(3)),
    })
  );
  const middlewareLive = Layer.mergeAll(
    BackendRequestContextMiddlewareLayer.pipe(
      Layer.provide(
        Layer.succeed(
          CurrentBackendRequestContext,
          CurrentBackendRequestContext.of(backendRequestContext())
        )
      )
    ),
    AuthSchemaErrorMiddlewareLive,
    AuthOriginCheckMiddlewareLive({
      mode: "secure",
      origins: [publicOrigin],
    }),
    SessionAuthenticationMiddlewareLayer.pipe(
      Layer.provide(
        RequestSessionAuthenticatorEffectAuthLayer.pipe(
          Layer.provide(requestAuthLive)
        )
      )
    ),
    MailboxSessionRequirementsMiddlewareLayer
  );
  const groupLive = MailboxHttpHandlersLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(MailboxAdministration, administration),
        Layer.succeed(
          OrganizationBootstrap,
          bootstrapByAdministration.get(administration) ??
            OrganizationBootstrap.of({
              bootstrap: () => Effect.succeed(mailbox),
            })
        ),
        Layer.succeed(MailboxNavigation, navigation),
        Layer.succeed(UserMailboxContactPreferences, contactPreferences),
        Layer.succeed(MailboxMessageReading, messageReading),
        Layer.succeed(MailboxMessageActions, messageActions),
        Layer.succeed(MailboxMessageHtmlReading, messageHtml),
        Layer.succeed(MailboxInlineAttachmentReading, inlineAttachments),
        Layer.succeed(MailboxInboundAttachmentReading, inboundAttachments),
        Layer.succeed(MailboxDraftEditing, draftEditing),
        Layer.succeed(MailboxDraftReading, draftReading),
        Layer.succeed(MailboxReplyDraftCreation, replyDraftCreation),
        Layer.succeed(MailboxDraftAttachments, draftAttachments),
        Layer.succeed(MailboxOutboundSending, outboundSending),
        Layer.succeed(MailboxOutboundDeliveryReading, outboundDeliveryReading),
        Layer.succeed(MailboxInboundReplay, inboundReplay),
        Layer.succeed(
          MailboxAuthorization,
          MailboxAuthorization.of({
            requireMailboxMessageRead: () => Effect.void,
            requireMailboxMessageModify: () => Effect.void,
          } as unknown as MailboxAuthorizationService)
        ),
        Layer.succeed(
          MailboxDoClient,
          MailboxDoClient.of({
            executeDirectory: () => Effect.die("Unexpected directory call"),
            executeMailData: () => Effect.die("Unexpected mail-data call"),
            publishChanges: () => Effect.void,
            resolveMailResource: () => Effect.die("Unexpected resource call"),
            subscribeChanges: () =>
              Effect.succeed(HttpServerResponse.empty({ status: 101 })),
          })
        ),
        Layer.succeed(
          MailboxInboundReplayAuthorization,
          MailboxInboundReplayAuthorization.of({ require: () => Effect.void })
        ),
        requestAuthLive,
        middlewareLive
      )
    )
  );

  return HttpRouter.toWebHandler(
    HttpApiBuilder.layer(MailboxTestApi).pipe(
      Layer.provide(Layer.merge(groupLive, middlewareLive)),
      Layer.provide(HttpApiPlatformLayer),
      Layer.provide(NodeServices.layer)
    ),
    { disableLogger: true }
  );
};

const mailboxRequest = (
  path: string,
  method: "GET" | "PATCH" | "POST" | "PUT",
  options: {
    readonly body?: unknown;
    readonly cookie?: boolean;
    readonly origin?: string | null;
  } = {}
) => {
  const headers = {
    "content-type": "application/json",
    ...(options.cookie === false
      ? {}
      : { cookie: `__Host-session=${sessionToken}` }),
    ...(options.origin === null
      ? {}
      : { origin: options.origin ?? publicOrigin }),
  };

  if (method === "GET") {
    return new Request(`https://backend.test${path}`, { headers });
  }
  const mutationMethod: "PATCH" | "POST" | "PUT" = method;
  const defaultBody =
    path === "/api/mailboxes/bootstrap-owner"
      ? {
          displayName: "Recruiting",
          operationId: "00000000-0000-4000-8000-000000000010",
        }
      : path === "/api/mailboxes/primary" && method === "PATCH"
        ? {
            displayName: "Recruiting",
            expectedVersion: 1,
            operationId: "00000000-0000-4000-8000-000000000011",
          }
        : { displayName: "Recruiting" };
  return new Request(`https://backend.test${path}`, {
    body: JSON.stringify(options.body ?? defaultBody),
    headers,
    method: mutationMethod,
  });
};

const makeReplyHandler = (reply: MailboxReplyDraftCreationService) =>
  makeHandler(
    makeAdministration(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    reply
  );

const validatedSessionWithClaims = (
  claims: SessionClaims | undefined
): ValidatedSession => ({
  ...validatedSession,
  currentSession: {
    ...validatedSession.currentSession,
    ...(claims === undefined ? {} : { claims }),
  },
  issued: {
    ...validatedSession.issued,
    ...(claims === undefined ? {} : { claims }),
  },
});

interface MailboxOperationCase {
  readonly operation: MailboxOperationName;
  readonly request: () => Request;
  readonly successStatus: number;
}

const draftContent = {
  bcc: [],
  cc: [],
  subject: "Draft",
  textBody: "Draft body",
  to: [],
} as const;

const mailboxOperationCases: readonly MailboxOperationCase[] = [
  {
    operation: MailboxOperation.actOnMessage,
    request: () =>
      mailboxRequest("/api/mailboxes/primary/messages/message-1", "PATCH", {
        body: {
          _tag: "SetRead",
          expectedVersion: 1,
          operationId: "message-action-1",
          read: true,
        },
      }),
    successStatus: 200,
  },
  {
    operation: MailboxOperation.bootstrapOwner,
    request: () => mailboxRequest("/api/mailboxes/bootstrap-owner", "POST"),
    successStatus: 201,
  },
  {
    operation: MailboxOperation.createDraft,
    request: () =>
      mailboxRequest("/api/mailboxes/primary/drafts", "POST", {
        body: { content: draftContent, operationId: "create-draft-1" },
      }),
    successStatus: 201,
  },
  {
    operation: MailboxOperation.getDraft,
    request: () =>
      mailboxRequest("/api/mailboxes/primary/drafts/draft-1", "GET"),
    successStatus: 200,
  },
  {
    operation: MailboxOperation.getInlineAttachment,
    request: () =>
      mailboxRequest(
        "/api/mailboxes/primary/messages/message-1/attachments/attachment-1/inline?folder=inbox",
        "GET"
      ),
    successStatus: 200,
  },
  {
    operation: MailboxOperation.getInboundAttachment,
    request: () =>
      mailboxRequest(
        "/api/mailboxes/primary/messages/message-1/attachments/attachment-1/download?folder=inbox",
        "GET"
      ),
    successStatus: 200,
  },
  {
    operation: MailboxOperation.getMessageHtml,
    request: () =>
      mailboxRequest(
        "/api/mailboxes/primary/messages/message-1/html?folder=inbox",
        "GET"
      ),
    successStatus: 200,
  },
  {
    operation: MailboxOperation.getNavigation,
    request: () => mailboxRequest("/api/mailboxes/current/navigation", "GET"),
    successStatus: 200,
  },
  {
    operation: MailboxOperation.getOutboundDelivery,
    request: () =>
      mailboxRequest("/api/mailboxes/primary/outbound/delivery-1", "GET"),
    successStatus: 200,
  },
  {
    operation: MailboxOperation.getThread,
    request: () =>
      mailboxRequest(
        "/api/mailboxes/primary/threads/thread-1?folder=inbox&message=message-1",
        "GET"
      ),
    successStatus: 200,
  },
  {
    operation: MailboxOperation.listDrafts,
    request: () => mailboxRequest("/api/mailboxes/primary/drafts", "GET"),
    successStatus: 200,
  },
  {
    operation: MailboxOperation.listMessages,
    request: () =>
      mailboxRequest("/api/mailboxes/primary/messages?folder=inbox", "GET"),
    successStatus: 200,
  },
  {
    operation: MailboxOperation.readOperation,
    request: () =>
      mailboxRequest(
        "/api/mailboxes/operations/00000000-0000-4000-8000-000000000010",
        "GET"
      ),
    successStatus: 200,
  },
  {
    operation: MailboxOperation.rename,
    request: () => mailboxRequest("/api/mailboxes/primary", "PATCH"),
    successStatus: 200,
  },
  {
    operation: MailboxOperation.replayInbound,
    request: () =>
      mailboxRequest("/api/mailboxes/primary/inbound/ingest-1/replay", "POST", {
        body: { operationId: "replay-inbound-1" },
      }),
    successStatus: 202,
  },
  {
    operation: MailboxOperation.createReplyDraft,
    request: () =>
      mailboxRequest(
        "/api/mailboxes/primary/threads/thread-1/messages/message-1/reply-draft",
        "POST",
        {
          body: {
            _tag: "Folder",
            folderId: "inbox",
            operationId: "reply-draft-1",
          },
        }
      ),
    successStatus: 201,
  },
  {
    operation: MailboxOperation.reserveDraftAttachment,
    request: () =>
      mailboxRequest(
        "/api/mailboxes/primary/drafts/draft-1/attachments/reservations",
        "POST",
        {
          body: {
            fileName: "brief.pdf",
            mimeType: "application/pdf",
            operationId: "reserve-attachment-1",
            size: 3,
          },
        }
      ),
    successStatus: 201,
  },
  {
    operation: MailboxOperation.sendDraft,
    request: () =>
      mailboxRequest("/api/mailboxes/primary/drafts/draft-1/send", "POST", {
        body: { expectedVersion: 1, operationId: "send-draft-1" },
      }),
    successStatus: 202,
  },
  {
    operation: MailboxOperation.undoSend,
    request: () =>
      mailboxRequest(
        "/api/mailboxes/primary/outbound/delivery-1/undo",
        "POST",
        { body: { expectedVersion: 1, operationId: "undo-send-1" } }
      ),
    successStatus: 200,
  },
  {
    operation: MailboxOperation.updateDraft,
    request: () =>
      mailboxRequest("/api/mailboxes/primary/drafts/draft-1", "PATCH", {
        body: {
          content: draftContent,
          expectedVersion: 1,
          operationId: "update-draft-1",
        },
      }),
    successStatus: 200,
  },
  {
    operation: MailboxOperation.uploadDraftAttachment,
    request: () =>
      new Request(
        "https://backend.test/api/mailboxes/primary/drafts/draft-1/attachments/attachment-1/content",
        {
          body: new Uint8Array([1, 2, 3]),
          headers: {
            "content-type": "application/octet-stream",
            cookie: `__Host-session=${sessionToken}`,
            origin: publicOrigin,
          },
          method: "PUT",
        }
      ),
    successStatus: 200,
  },
];

const makeCountingHandler = (session: ValidatedSession) => {
  const counts = Object.fromEntries(
    Object.values(MailboxOperation).map((operation) => [operation, 0])
  ) as Record<MailboxOperationName, number>;
  const counted = <A>(operation: MailboxOperationName, value: A) =>
    Effect.sync(() => {
      counts[operation] += 1;
      return value;
    });

  return {
    counts,
    ...makeHandler(
      makeAdministration({
        bootstrapOwner: () => counted(MailboxOperation.bootstrapOwner, mailbox),
        readOperation: () =>
          counted(MailboxOperation.readOperation, mailboxAdministrationReceipt),
        rename: () => counted(MailboxOperation.rename, mailbox),
      }),
      () => Effect.succeed(session),
      MailboxNavigation.of({
        getCurrent: counted(MailboxOperation.getNavigation, mailboxNavigation),
      }),
      MailboxMessageReading.of({
        listView: () => counted(MailboxOperation.listMessages, mailboxMessages),
        openThread: () => counted(MailboxOperation.getThread, mailboxThread),
        readMessage: () => Effect.die("Unexpected message read"),
      }),
      MailboxMessageActions.of({
        executeBatch: () => Effect.die("Unexpected batch message action"),
        execute: () =>
          counted(MailboxOperation.actOnMessage, mailboxMessageAction),
        setThreadRead: () => Effect.die("Unexpected thread read action"),
      }),
      MailboxMessageHtmlReading.of({
        get: () => counted(MailboxOperation.getMessageHtml, mailboxMessageHtml),
      }),
      MailboxInlineAttachmentReading.of({
        get: () =>
          counted(MailboxOperation.getInlineAttachment, {
            bytes: new Uint8Array([1, 2, 3]),
            mimeType: Schema.decodeUnknownSync(MimeType)("image/png"),
          }),
      }),
      MailboxDraftEditing.of({
        create: () => counted(MailboxOperation.createDraft, mailboxDraft),
        get: () => counted(MailboxOperation.getDraft, mailboxDraft),
        update: () => counted(MailboxOperation.updateDraft, mailboxDraft),
      }),
      MailboxDraftAttachments.of({
        reserve: () =>
          counted(MailboxOperation.reserveDraftAttachment, draftAttachment),
        upload: () =>
          counted(
            MailboxOperation.uploadDraftAttachment,
            draftAttachmentUpload
          ),
      }),
      MailboxOutboundSending.of({
        send: () => counted(MailboxOperation.sendDraft, mailboxDraftSend),
        undo: () => counted(MailboxOperation.undoSend, cancelledDelivery),
      }),
      MailboxOutboundDeliveryReading.of({
        get: () =>
          counted(
            MailboxOperation.getOutboundDelivery,
            mailboxOutboundDelivery
          ),
      }),
      MailboxDraftReading.of({
        list: () => counted(MailboxOperation.listDrafts, mailboxDrafts),
      }),
      MailboxInboundReplay.of({
        replay: () =>
          counted(MailboxOperation.replayInbound, replayedProcessing),
      }),
      MailboxInboundAttachmentReading.of({
        get: () =>
          counted(MailboxOperation.getInboundAttachment, {
            bytes: new Uint8Array([1, 2, 3]),
            fileName: "brief.pdf",
            mimeType: Schema.decodeUnknownSync(MimeType)("application/pdf"),
          }),
      }),
      MailboxReplyDraftCreation.of({
        create: () => counted(MailboxOperation.createReplyDraft, mailboxDraft),
      })
    ),
  };
};

describe("protected mailbox API", () => {
  it("binds reply params and accepts only Folder/Label context plus operationId", async () => {
    let received: unknown;
    const { dispose, handler } = makeReplyHandler(
      MailboxReplyDraftCreation.of({
        create: (command) => {
          received = command;
          return Effect.succeed(mailboxDraft);
        },
      })
    );
    try {
      const response = await handler(
        mailboxRequest(
          "/api/mailboxes/primary/threads/thread-1/messages/message-1/reply-draft",
          "POST",
          {
            body: {
              _tag: "Label",
              labelId: "work",
              operationId: "reply-payload",
              sender: { address: "attacker@example.test" },
              to: [{ address: "attacker@example.test" }],
            },
          }
        )
      );

      expect({ received, status: response.status }).toStrictEqual({
        received: {
          _tag: "Label",
          labelId: "work",
          mailboxId: "primary",
          messageId: "message-1",
          operationId: "reply-payload",
          threadId: "thread-1",
        },
        status: 201,
      });
    } finally {
      await dispose();
    }
  });

  it.each([
    ["invalid-input", 400, "Invalid reply target"],
    ["not-found", 404, "Reply target not found"],
    ["conflict", 409, "Reply draft operation conflict"],
  ] as const)(
    "maps reply %s errors without leaking target data",
    async (reason, status, message) => {
      const { dispose, handler } = makeReplyHandler(
        MailboxReplyDraftCreation.of({
          create: () =>
            Effect.fail(
              new MailboxReplyDraftCreationError({
                message: "sensitive internal detail",
                reason,
              })
            ),
        })
      );
      try {
        const response = await handler(
          mailboxRequest(
            "/api/mailboxes/primary/threads/thread-1/messages/message-1/reply-draft",
            "POST",
            {
              body: {
                _tag: "Folder",
                folderId: "inbox",
                operationId: "reply-error",
              },
            }
          )
        );
        expect({
          body: await response.json(),
          status: response.status,
        }).toMatchObject({
          body: { message },
          status,
        });
      } finally {
        await dispose();
      }
    }
  );

  it.each(mailboxOperationCases)(
    "allows unrestricted session for $operation",
    async ({ operation, request, successStatus }) => {
      const { counts, dispose, handler } =
        makeCountingHandler(validatedSession);
      try {
        const response = await handler(request());
        expect(response.status).toBe(successStatus);
        expect(counts[operation]).toBe(1);
      } finally {
        await dispose();
      }
    }
  );

  it.each(mailboxOperationCases)(
    "denies exact recovery remediation for $operation",
    async ({ operation, request }) => {
      const restricted = validatedSessionWithClaims({
        recoveryRemediation: { allowed: ["second-passkey"] },
        requirements: ["recovery_remediation"],
      });
      const { counts, dispose, handler } = makeCountingHandler(restricted);
      try {
        const response = await handler(request());
        expect({
          body: await response.json(),
          count: counts[operation],
          status: response.status,
        }).toStrictEqual({
          body: {
            _tag: "AuthPolicyDeniedError",
            code: "policy_denied",
            message: "Mailbox operation denied",
          },
          count: 0,
          status: 403,
        });
      } finally {
        await dispose();
      }
    }
  );

  it.each([
    ["unfinished requirement", { requirements: ["email_verification"] }],
    [
      "dangling capability",
      {
        recoveryRemediation: { allowed: ["second-passkey"] },
        requirements: [],
      },
    ],
  ] as const)("denies representative %s claims", async (_, claims) => {
    const { counts, dispose, handler } = makeCountingHandler(
      validatedSessionWithClaims(claims)
    );
    try {
      const response = await handler(
        mailboxRequest("/api/mailboxes/current/navigation", "GET")
      );
      expect({
        body: await response.json(),
        count: counts.getNavigation,
        status: response.status,
      }).toStrictEqual({
        body: {
          _tag: "AuthPolicyDeniedError",
          code: "policy_denied",
          message: "Mailbox operation denied",
        },
        count: 0,
        status: 403,
      });
    } finally {
      await dispose();
    }
  });

  // oxlint-disable-next-line vitest/max-expects -- One route matrix verifies binding, provenance, public bodies, and archive denial.
  it("sends, reads, and undoes with path identity", async () => {
    const commands: unknown[] = [];
    const provenances: unknown[] = [];
    const queries: unknown[] = [];
    const { dispose, handler } = makeHandler(
      makeAdministration(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      MailboxOutboundSending.of({
        send: (command) =>
          Effect.gen(function* () {
            commands.push(command);
            provenances.push(
              Option.getOrUndefined(
                yield* Effect.serviceOption(CurrentMailboxOperationProvenance)
              )
            );
            return mailboxDraftSend;
          }),
        undo: (command) => {
          commands.push(command);
          return Effect.succeed(cancelledDelivery);
        },
      }),
      MailboxOutboundDeliveryReading.of({
        get: (query) => {
          queries.push(query);
          return Effect.succeed(mailboxOutboundDelivery);
        },
      })
    );

    try {
      const sent = await handler(
        mailboxRequest("/api/mailboxes/primary/drafts/draft-1/send", "POST", {
          body: { expectedVersion: 1, operationId: "operation-send" },
        })
      );
      const undone = await handler(
        mailboxRequest(
          "/api/mailboxes/primary/outbound/delivery-1/undo",
          "POST",
          {
            body: { expectedVersion: 1, operationId: "operation-undo" },
          }
        )
      );
      const read = await handler(
        mailboxRequest("/api/mailboxes/primary/outbound/delivery-1", "GET")
      );
      const attemptedArchiveAuthority = await handler(
        mailboxRequest("/api/mailboxes/primary/drafts/draft-1/send", "POST", {
          body: {
            archiveRecipient: "attacker-archive@example.net",
            expectedVersion: 1,
            operationId: "operation-send-attacker-archive",
          },
        })
      );

      expect({
        read: read.status,
        send: sent.status,
        undo: undone.status,
        attemptedArchiveAuthority: attemptedArchiveAuthority.status,
      }).toStrictEqual({
        attemptedArchiveAuthority: 400,
        read: 200,
        send: 202,
        undo: 200,
      });
      expect(commands).toStrictEqual([
        {
          draftId: "draft-1",
          expectedVersion: 1,
          mailboxId: "primary",
          operationId: "operation-send",
        },
        {
          expectedVersion: 1,
          mailboxId: "primary",
          operationId: "operation-undo",
          outboundDeliveryId: "delivery-1",
        },
      ]);
      expect(provenances).toMatchObject([
        {
          _tag: "ExplicitUserAction",
          action: "send-draft",
          actor: { sessionId: "session-a", userId: "user-a" },
          expectedVersion: 1,
          mailboxId: "primary",
          operationId: "operation-send",
          resource: { _tag: "Draft", draftId: "draft-1" },
          session: { sessionId: "session-a", userId: "user-a" },
        },
      ]);
      expect(queries).toStrictEqual([
        { mailboxId: "primary", outboundDeliveryId: "delivery-1" },
      ]);
      const publicBodies = await Promise.all([
        sent.json(),
        undone.json(),
        read.json(),
      ]);
      expect(publicBodies).toMatchObject([
        {
          delivery: { id: "delivery-1", mailboxId: "primary" },
          serverNow: 1000,
        },
        {
          id: "delivery-1",
          mailboxId: "primary",
          status: "cancelled",
        },
        {
          delivery: { id: "delivery-1", mailboxId: "primary" },
          serverNow: 2000,
        },
      ]);
      expect(
        JSON.stringify({
          attemptedArchiveAuthority: await attemptedArchiveAuthority.json(),
          publicBodies,
        })
      ).not.toContain("attacker-archive@example.net");
    } finally {
      await dispose();
    }
  });

  it("rejects public send provenance without invoking the service", async () => {
    let sends = 0;
    const { dispose, handler } = makeHandler(
      makeAdministration(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      MailboxOutboundSending.of({
        send: () => {
          sends += 1;
          return Effect.succeed(mailboxDraftSend);
        },
        undo: () => Effect.succeed(cancelledDelivery),
      })
    );

    try {
      const response = await handler(
        mailboxRequest("/api/mailboxes/primary/drafts/draft-1/send", "POST", {
          body: {
            expectedVersion: 1,
            operationId: "operation-send",
            provenance: { _tag: "ExplicitUserAction" },
          },
        })
      );

      expect(response.status).toBe(400);
      expect(sends).toBe(0);
    } finally {
      await dispose();
    }
  });

  it("maps a missing explicit send action to a sanitized forbidden response", async () => {
    const { dispose, handler } = makeHandler(
      makeAdministration(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      MailboxOutboundSending.of({
        send: () =>
          Effect.fail(
            new MailboxOutboundSendingError({
              cause: new Error("private provenance details"),
              message: "private mismatch",
              operation: "send",
              reason: "user-action-required",
            })
          ),
        undo: () => Effect.succeed(cancelledDelivery),
      })
    );

    try {
      const response = await handler(
        mailboxRequest("/api/mailboxes/primary/drafts/draft-1/send", "POST", {
          body: { expectedVersion: 1, operationId: "operation-send" },
        })
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toMatchObject({
        code: "policy_denied",
        message: "Explicit user action required to send mail",
      });
      expect(JSON.stringify(body)).not.toContain("private");
    } finally {
      await dispose();
    }
  });

  it("reserves and uploads raw draft attachment bytes", async () => {
    const { dispose, handler } = makeHandler(makeAdministration());

    try {
      const reserved = await handler(
        mailboxRequest(
          "/api/mailboxes/primary/drafts/draft-1/attachments/reservations",
          "POST",
          {
            body: {
              fileName: "brief.pdf",
              mimeType: "application/pdf",
              operationId: "reserve-1",
              size: 3,
            },
          }
        )
      );
      const uploaded = await handler(
        new Request(
          "https://backend.test/api/mailboxes/primary/drafts/draft-1/attachments/attachment-1/content",
          {
            body: new Uint8Array([1, 2, 3]),
            headers: {
              "content-type": "application/octet-stream",
              cookie: `__Host-session=${sessionToken}`,
              origin: publicOrigin,
            },
            method: "PUT",
          }
        )
      );

      expect({
        reserve: reserved.status,
        upload: uploaded.status,
      }).toStrictEqual({ reserve: 201, upload: 200 });
      await expect(reserved.json()).resolves.toMatchObject({
        id: "attachment-1",
        status: "reserved",
      });
      await expect(uploaded.json()).resolves.toMatchObject({
        attachment: { id: "attachment-1", status: "stored" },
        draftVersion: 2,
      });
    } finally {
      await dispose();
    }
  });

  it("returns an independently authorized inline attachment", async () => {
    const { dispose, handler } = makeHandler(makeAdministration());

    try {
      const response = await handler(
        mailboxRequest(
          "/api/mailboxes/primary/messages/message-1/attachments/attachment-1/inline?folder=inbox",
          "GET"
        )
      );

      expect({
        contentDisposition: response.headers.get("content-disposition"),
        contentLength: response.headers.get("content-length"),
        contentType: response.headers.get("content-type"),
        status: response.status,
      }).toStrictEqual({
        contentDisposition: "inline",
        contentLength: "3",
        contentType: "image/png",
        status: 200,
      });
      await expect(response.arrayBuffer()).resolves.toStrictEqual(
        new Uint8Array([1, 2, 3]).buffer
      );
    } finally {
      await dispose();
    }
  });

  it("returns an independently authorized ordinary attachment download", async () => {
    const { dispose, handler } = makeHandler(makeAdministration());

    try {
      const response = await handler(
        mailboxRequest(
          "/api/mailboxes/primary/messages/message-1/attachments/attachment-1/download?folder=inbox",
          "GET"
        )
      );

      expect({
        cache: response.headers.get("cache-control"),
        contentDisposition: response.headers.get("content-disposition"),
        contentLength: response.headers.get("content-length"),
        contentType: response.headers.get("content-type"),
        nosniff: response.headers.get("x-content-type-options"),
        status: response.status,
      }).toStrictEqual({
        cache: "private, no-store",
        contentDisposition:
          "attachment; filename=\"brief.pdf\"; filename*=UTF-8''brief.pdf",
        contentLength: "3",
        contentType: "application/pdf",
        nosniff: "nosniff",
        status: 200,
      });
      await expect(response.arrayBuffer()).resolves.toStrictEqual(
        new Uint8Array([1, 2, 3]).buffer
      );
    } finally {
      await dispose();
    }
  });

  it("rejects the ordinary attachment Backend endpoint without a session", async () => {
    const { dispose, handler } = makeHandler(makeAdministration());

    try {
      const response = await handler(
        new Request(
          "https://backend.test/api/mailboxes/primary/messages/message-1/attachments/attachment-1/download?folder=inbox",
          { headers: { origin: publicOrigin } }
        )
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        code: "unauthenticated",
      });
    } finally {
      await dispose();
    }
  });

  it("returns independently authorized sandboxed message HTML", async () => {
    const { dispose, handler } = makeHandler(makeAdministration());

    try {
      const response = await handler(
        mailboxRequest(
          "/api/mailboxes/primary/messages/message-1/html?folder=inbox",
          "GET"
        )
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual(mailboxMessageHtml);
    } finally {
      await dispose();
    }
  });

  it("executes a versioned mailbox message action", async () => {
    let actionCommand: unknown;
    const { dispose, handler } = makeHandler(
      makeAdministration(),
      undefined,
      undefined,
      undefined,
      MailboxMessageActions.of({
        executeBatch: () => Effect.die("Unexpected batch message action"),
        execute: (command) => {
          actionCommand = command;
          return Effect.succeed(mailboxMessageAction);
        },
        setThreadRead: () => Effect.die("Unexpected thread read action"),
      })
    );

    try {
      const response = await handler(
        mailboxRequest("/api/mailboxes/primary/messages/message-1", "PATCH", {
          body: {
            _tag: "SetRead",
            expectedVersion: 1,
            operationId: "operation-1",
            read: true,
          },
        })
      );

      expect(response.status).toBe(200);
      expect(actionCommand).toMatchObject({
        _tag: "SetRead",
        mailboxId: "primary",
        messageId: "message-1",
        operationId: "operation-1",
        read: true,
      });
      await expect(response.json()).resolves.toMatchObject({
        id: "message-1",
        read: true,
        version: 2,
      });
    } finally {
      await dispose();
    }
  });

  it("executes mailbox message actions through one batch endpoint", async () => {
    let batchCommand: unknown;
    const { dispose, handler } = makeHandler(
      makeAdministration(),
      undefined,
      undefined,
      undefined,
      MailboxMessageActions.of({
        execute: () => Effect.die("Unexpected single message action"),
        executeBatch: (command) => {
          batchCommand = command;
          return Effect.succeed({
            batchOperationId: command.batchOperationId,
            results: command.actions.map((action) => ({
              _tag: "Succeeded" as const,
              action: mailboxMessageAction,
              messageId: action.messageId,
              operationId: action.operationId,
            })),
          });
        },
        setThreadRead: () => Effect.die("Unexpected thread read action"),
      })
    );

    try {
      const response = await handler(
        mailboxRequest(
          "/api/mailboxes/primary/messages/batch-actions",
          "POST",
          {
            body: {
              actions: [
                {
                  _tag: "SetRead",
                  expectedVersion: 1,
                  messageId: "message-1",
                  operationId: "batch-item-1",
                  read: true,
                },
              ],
              batchOperationId: "batch-operation-1",
            },
          }
        )
      );

      expect({
        body: await response.json(),
        command: batchCommand,
        status: response.status,
      }).toMatchObject({
        body: {
          batchOperationId: "batch-operation-1",
          results: [{ _tag: "Succeeded", messageId: "message-1" }],
        },
        command: {
          actions: [{ _tag: "SetRead", messageId: "message-1" }],
          batchOperationId: "batch-operation-1",
          mailboxId: "primary",
        },
        status: 200,
      });
    } finally {
      await dispose();
    }
  });

  it("sets a mailbox thread read through the dedicated endpoint", async () => {
    let command: unknown;
    const { dispose, handler } = makeHandler(
      makeAdministration(),
      undefined,
      undefined,
      undefined,
      MailboxMessageActions.of({
        execute: () => Effect.die("Unexpected single message action"),
        executeBatch: () => Effect.die("Unexpected batch message action"),
        setThreadRead: (input) => {
          command = input;
          return Effect.succeed({
            changed: [mailboxMessageAction],
            operationId: input.operationId,
            threadId: input.threadId,
          });
        },
      })
    );

    try {
      const response = await handler(
        mailboxRequest("/api/mailboxes/primary/threads/thread-1/read", "POST", {
          body: { operationId: "thread-read-operation-1" },
        })
      );

      expect({
        body: await response.json(),
        command,
        status: response.status,
      }).toMatchObject({
        body: {
          changed: [{ id: "message-1", read: true, version: 2 }],
          operationId: "thread-read-operation-1",
          threadId: "thread-1",
        },
        command: {
          mailboxId: "primary",
          operationId: "thread-read-operation-1",
          threadId: "thread-1",
        },
        status: 200,
      });
    } finally {
      await dispose();
    }
  });

  it("maps a missing action resource to not found", async () => {
    const { dispose, handler } = makeHandler(
      makeAdministration(),
      undefined,
      undefined,
      undefined,
      MailboxMessageActions.of({
        executeBatch: () => Effect.die("Unexpected batch message action"),
        execute: (command) =>
          Effect.fail(
            new MailResourceResolveError({
              message: "Message not found",
              reason: "not-found",
              resource: {
                _tag: "Message",
                mailboxId: command.mailboxId,
                messageId: command.messageId,
              },
            })
          ),
        setThreadRead: () => Effect.die("Unexpected thread read action"),
      })
    );

    try {
      const response = await handler(
        mailboxRequest("/api/mailboxes/primary/messages/missing", "PATCH", {
          body: {
            _tag: "Trash",
            expectedVersion: 1,
            operationId: "operation-missing",
          },
        })
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        code: "not_found",
      });
    } finally {
      await dispose();
    }
  });

  it("returns the selected mailbox message view", async () => {
    const { dispose, handler } = makeHandler(makeAdministration());

    try {
      const response = await handler(
        mailboxRequest("/api/mailboxes/primary/messages?folder=inbox", "GET")
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        items: [{ id: "message-1", threadId: "thread-1" }],
      });
    } finally {
      await dispose();
    }
  });

  it("lists bounded draft summaries with decoded pagination", async () => {
    let input: unknown;
    const { dispose, handler } = makeHandler(
      makeAdministration(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      MailboxDraftReading.of({
        list: (query) => {
          input = query;
          return Effect.succeed(mailboxDrafts);
        },
      })
    );

    try {
      const response = await handler(
        mailboxRequest(
          "/api/mailboxes/primary/drafts?cursor=page-2&limit=10",
          "GET"
        )
      );
      const body = await response.json();

      expect({ body, input, status: response.status }).toMatchObject({
        body: {
          items: [
            {
              hasAttachments: true,
              id: "draft-1",
              mailboxId: "primary",
              snippet: "Draft preview",
            },
          ],
          nextCursor: "next-drafts",
        },
        input: {
          mailboxId: "primary",
          page: { cursor: "page-2", limit: 10 },
        },
        status: 200,
      });
      expect(JSON.stringify(body)).not.toContain("textBody");
    } finally {
      await dispose();
    }
  });

  it("decodes mailbox search, filters, and cursor before the use case", async () => {
    let listInput: unknown;
    const { dispose, handler } = makeHandler(
      makeAdministration(),
      undefined,
      undefined,
      MailboxMessageReading.of({
        listView: (input) => {
          listInput = input;
          return Effect.succeed(mailboxMessages);
        },
        openThread: () => Effect.succeed(mailboxThread),
        readMessage: () => Effect.die("Unexpected message read"),
      })
    );

    try {
      const response = await handler(
        mailboxRequest(
          "/api/mailboxes/primary/messages?label=work&q=quarterly+report&read=false&starred=true&attachment=true&cursor=page-2",
          "GET"
        )
      );

      expect(response.status).toBe(200);
      expect(listInput).toMatchObject({
        _tag: "Label",
        cursor: "page-2",
        hasAttachment: true,
        labelId: "work",
        mailboxId: "primary",
        query: "quarterly report",
        read: false,
        starred: true,
      });
    } finally {
      await dispose();
    }
  });

  it("returns bad request for an invalid message cursor", async () => {
    const { dispose, handler } = makeHandler(
      makeAdministration(),
      undefined,
      undefined,
      MailboxMessageReading.of({
        listView: () =>
          Effect.fail(
            new MailboxMessageReadingError({
              message: "Mailbox message query is invalid",
              reason: "invalid-input",
            })
          ),
        openThread: () => Effect.succeed(mailboxThread),
        readMessage: () => Effect.die("Unexpected message read"),
      })
    );

    try {
      const response = await handler(
        mailboxRequest(
          "/api/mailboxes/primary/messages?folder=inbox&cursor=tampered",
          "GET"
        )
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: "bad_request",
        message: "Invalid mailbox message query",
      });
    } finally {
      await dispose();
    }
  });

  it("returns a plain-text mailbox thread projection", async () => {
    const { dispose, handler } = makeHandler(makeAdministration());

    try {
      const response = await handler(
        mailboxRequest(
          "/api/mailboxes/primary/threads/thread-1?folder=inbox&message=message-1",
          "GET"
        )
      );
      const body = await response.json();

      expect({ body, status: response.status }).toMatchObject({
        body: {
          messages: [
            {
              hasHtmlBody: true,
              id: "message-1",
              textBody: "Plain text body",
            },
          ],
          thread: { id: "thread-1" },
        },
        status: 200,
      });
      expect(JSON.stringify(body)).not.toContain("htmlBody");
    } finally {
      await dispose();
    }
  });

  it("rejects an ambiguous mailbox message view before the use case", async () => {
    let reads = 0;
    const { dispose, handler } = makeHandler(
      makeAdministration(),
      () => Effect.succeed(validatedSession),
      undefined,
      MailboxMessageReading.of({
        listView: () => {
          reads += 1;
          return Effect.succeed(mailboxMessages);
        },
        openThread: () => Effect.succeed(mailboxThread),
        readMessage: () => Effect.die("Unexpected message read"),
      })
    );

    try {
      const response = await handler(
        mailboxRequest(
          "/api/mailboxes/primary/messages?folder=inbox&label=work",
          "GET"
        )
      );

      expect({ reads, status: response.status }).toStrictEqual({
        reads: 0,
        status: 400,
      });
    } finally {
      await dispose();
    }
  });

  it("returns authorized mailbox navigation", async () => {
    const { dispose, handler } = makeHandler(makeAdministration());

    try {
      const response = await handler(
        mailboxRequest("/api/mailboxes/current/navigation", "GET")
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        folders: [{ id: "inbox", unreadCount: 2 }],
        labels: [],
        mailbox: {
          displayName: "Inbox",
          id: "primary",
          primaryAddress: "inbox@example.com",
        },
      });
    } finally {
      await dispose();
    }
  });

  it("reads and updates the current user's contact preferences", async () => {
    const { dispose, handler } = makeHandler(makeAdministration());

    try {
      const read = await handler(
        mailboxRequest("/api/mailboxes/mailbox-a/preferences/contacts", "GET")
      );
      const update = await handler(
        mailboxRequest(
          "/api/mailboxes/mailbox-a/preferences/contacts",
          "PATCH",
          {
            body: { expectedVersion: 0, visibility: "all-participants" },
          }
        )
      );

      expect(read.status).toBe(200);
      await expect(read.json()).resolves.toMatchObject({
        mailboxId: "mailbox-a",
        version: 0,
        visibility: "safe",
      });
      expect(update.status).toBe(200);
    } finally {
      await dispose();
    }
  });

  it("maps missing current mailbox navigation to a sanitized response", async () => {
    const { dispose, handler } = makeHandler(
      makeAdministration(),
      () => Effect.succeed(validatedSession),
      MailboxNavigation.of({
        getCurrent: Effect.fail(
          new MailboxNavigationError({
            cause: new Error("member lookup details"),
            message: "Current mailbox was not found",
            reason: "not-found",
          })
        ),
      })
    );

    try {
      const response = await handler(
        mailboxRequest("/api/mailboxes/current/navigation", "GET")
      );
      const body = await response.json();

      expect({ body, status: response.status }).toStrictEqual({
        body: {
          _tag: "AuthNotFoundError",
          code: "not_found",
          message: "Mailbox not found",
        },
        status: 404,
      });
      expect(JSON.stringify(body)).not.toContain("member lookup");
    } finally {
      await dispose();
    }
  });

  it("accepts a fenced inbound replay request", async () => {
    const { dispose, handler } = makeHandler(makeAdministration());

    try {
      const response = await handler(
        mailboxRequest(
          "/api/mailboxes/primary/inbound/ingest-1/replay",
          "POST",
          { body: { operationId: "operation-1" } }
        )
      );

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toMatchObject({
        attemptCount: 2,
        id: "ingest-1",
        status: "received",
      });
    } finally {
      await dispose();
    }
  });

  it("returns a schema-encoded owner bootstrap response", async () => {
    let validations = 0;
    const { dispose, handler } = makeHandler(makeAdministration(), () => {
      validations += 1;
      return Effect.succeed(validatedSession);
    });

    try {
      const response = await handler(
        mailboxRequest("/api/mailboxes/bootstrap-owner", "POST")
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        displayName: "Inbox",
        id: "primary",
        status: "active",
      });
      expect(validations).toBe(1);
    } finally {
      await dispose();
    }
  });

  it("passes the recovery rotation operation only as bootstrap expected state", async () => {
    let command: unknown;
    const { dispose, handler } = makeHandler(
      makeAdministration({
        bootstrapOwner: (input) => {
          command = input;
          return Effect.succeed(mailbox);
        },
      })
    );
    try {
      const response = await handler(
        mailboxRequest("/api/mailboxes/bootstrap-owner", "POST", {
          body: {
            acknowledgedRecoveryCodeRotationOperationId:
              "00000000-0000-4000-8000-000000000105",
            displayName: "Inbox",
            operationId: "00000000-0000-4000-8000-000000000010",
          },
        })
      );

      expect(response.status).toBe(201);
      expect(command).toStrictEqual({
        acknowledgedRecoveryCodeRotationOperationId:
          "00000000-0000-4000-8000-000000000105",
        displayName: "Inbox",
        operationId: "00000000-0000-4000-8000-000000000010",
      });
      expect(JSON.stringify(await response.json())).not.toContain(
        "acknowledgedRecoveryCodeRotationOperationId"
      );
    } finally {
      await dispose();
    }
  });

  it.each([
    ["actorUserId", "user-attacker"],
    ["initialAddress", "attacker@external.test"],
    ["initialDomain", "external.test"],
    ["mailboxId", "attacker-mailbox"],
    ["organizationId", "attacker-organization"],
    ["ownerEmailAllowlist", ["attacker@external.test"]],
    ["ownerUserId", "user-attacker"],
    ["protocol", "attacker-protocol"],
    ["protocolGeneration", 2],
    ["protocolMarker", "attacker-marker"],
    ["protocolVersion", 2],
    ["recoveryCodeCount", 10],
    ["recoveryReady", true],
    ["passkeyCount", 2],
    ["securitySetupReady", true],
  ] as const)(
    "rejects public authority field %s before invoking bootstrap",
    async (field, value) => {
      let bootstraps = 0;
      const { dispose, handler } = makeHandler(
        makeAdministration({
          bootstrapOwner: () => {
            bootstraps += 1;
            return Effect.succeed(mailbox);
          },
        })
      );
      try {
        const response = await handler(
          mailboxRequest("/api/mailboxes/bootstrap-owner", "POST", {
            body: {
              displayName: "Inbox",
              [field]: value,
              operationId: "00000000-0000-4000-8000-000000000010",
            },
          })
        );

        expect(response.status).toBe(400);
        expect(bootstraps).toBe(0);
      } finally {
        await dispose();
      }
    }
  );

  it("returns an authenticated typed mailbox operation receipt", async () => {
    const { dispose, handler } = makeHandler(makeAdministration());
    try {
      const response = await handler(
        mailboxRequest(
          "/api/mailboxes/operations/00000000-0000-4000-8000-000000000010",
          "GET"
        )
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("pragma")).toBe("no-cache");
      await expect(response.json()).resolves.toMatchObject({
        actorUserId: "user-a",
        operationId: "00000000-0000-4000-8000-000000000010",
        operationKind: "bootstrap-owner",
        result: { id: "primary", version: 1 },
        schemaVersion: 1,
      });
    } finally {
      await dispose();
    }
  });

  it("maps operation-ID intent conflicts without leaking internal details", async () => {
    const { dispose, handler } = makeHandler(
      makeAdministration({
        bootstrapOwner: () =>
          Effect.fail(
            new OrganizationBootstrapError({
              cause: new Error("stored actor and intent details"),
              message: "sensitive operation mismatch",
              operation: "bootstrap-owner",
              reason: "operation-conflict",
            })
          ),
      })
    );
    try {
      const response = await handler(
        mailboxRequest("/api/mailboxes/bootstrap-owner", "POST")
      );
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body).toMatchObject({
        code: "conflict",
        message: "Mailbox operation ID conflict",
      });
      expect(JSON.stringify(body)).not.toContain("sensitive");
      expect(JSON.stringify(body)).not.toContain("stored actor");
    } finally {
      await dispose();
    }
  });

  it("rejects a missing session before invoking the operation", async () => {
    let bootstraps = 0;
    const { dispose, handler } = makeHandler(
      makeAdministration({
        bootstrapOwner: () => {
          bootstraps += 1;
          return Effect.succeed(mailbox);
        },
      })
    );

    try {
      const response = await handler(
        mailboxRequest("/api/mailboxes/bootstrap-owner", "POST", {
          cookie: false,
        })
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        code: "unauthenticated",
        message: "Unauthenticated",
      });
      expect(bootstraps).toBe(0);
    } finally {
      await dispose();
    }
  });

  it("rejects an invalid session before invoking the operation", async () => {
    let bootstraps = 0;
    const { dispose, handler } = makeHandler(
      makeAdministration({
        bootstrapOwner: () => {
          bootstraps += 1;
          return Effect.succeed(mailbox);
        },
      }),
      () => Effect.fail(new SessionValidateError({ message: "Invalid token" }))
    );

    try {
      const response = await handler(
        mailboxRequest("/api/mailboxes/bootstrap-owner", "POST")
      );

      expect(response.status).toBe(401);
      expect(bootstraps).toBe(0);
    } finally {
      await dispose();
    }
  });

  it.each([
    ["cross-origin", "https://attacker.test"],
    ["missing-origin", null],
  ] as const)(
    "rejects a %s mutation before session validation",
    async (_, origin) => {
      let validations = 0;
      let bootstraps = 0;
      const { dispose, handler } = makeHandler(
        makeAdministration({
          bootstrapOwner: () => {
            bootstraps += 1;
            return Effect.succeed(mailbox);
          },
        }),
        () => {
          validations += 1;
          return Effect.succeed(validatedSession);
        }
      );

      try {
        const response = await handler(
          mailboxRequest("/api/mailboxes/bootstrap-owner", "POST", {
            origin,
          })
        );

        expect(response.status).toBe(403);
        expect(validations).toBe(0);
        expect(bootstraps).toBe(0);
      } finally {
        await dispose();
      }
    }
  );

  it("maps policy denial to a cause-free forbidden response", async () => {
    const { dispose, handler } = makeHandler(
      makeAdministration({
        rename: () =>
          Effect.fail(
            new AuthPolicy.AuthorizationError({
              cause: new Error("sensitive policy details"),
              reason: "missing-permission",
            })
          ),
      })
    );

    try {
      const response = await handler(
        mailboxRequest("/api/mailboxes/primary", "PATCH")
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toMatchObject({
        code: "policy_denied",
        message: "Access denied",
      });
      expect(JSON.stringify(body)).not.toContain("sensitive");
    } finally {
      await dispose();
    }
  });

  it("returns a typed step-up response for owner bootstrap", async () => {
    const { dispose, handler } = makeHandler(
      makeAdministration({
        bootstrapOwner: () =>
          Effect.fail(
            new OrganizationBootstrapError({
              message: "internal policy detail",
              operation: "bootstrap-owner",
              reason: "step-up-required",
            })
          ),
      })
    );

    try {
      const response = await handler(
        mailboxRequest("/api/mailboxes/bootstrap-owner", "POST")
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toStrictEqual({
        _tag: "AuthStepUpRequiredError",
        code: "step_up_required",
        message: "Recent authentication required",
      });
      expect(JSON.stringify(body)).not.toContain("internal policy detail");
    } finally {
      await dispose();
    }
  });

  it("returns a privacy-safe typed security-setup response for owner bootstrap", async () => {
    const { dispose, handler } = makeHandler(
      makeAdministration({
        bootstrapOwner: () =>
          Effect.fail(
            new OrganizationBootstrapError({
              cause: new Error("passkey and recovery row details"),
              message: "internal readiness detail",
              operation: "bootstrap-owner",
              reason: "security-setup-required",
            })
          ),
      })
    );

    try {
      const response = await handler(
        mailboxRequest("/api/mailboxes/bootstrap-owner", "POST")
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toStrictEqual({
        _tag: "AuthPolicyDeniedError",
        code: "policy_denied",
        message: "Security setup required",
      });
      expect(JSON.stringify(body)).not.toMatch(
        /internal readiness|row details|credential|count/iu
      );
    } finally {
      await dispose();
    }
  });

  it("maps transactional denial without leaking scope or causes", async () => {
    const { dispose, handler } = makeHandler(
      makeAdministration({
        rename: () =>
          Effect.fail(
            new MailboxAdministrationError({
              cause: new Error("D1 details"),
              message: "permission mailbox.manage_settings@primary changed",
              operation: "rename",
              reason: "authorization-recheck",
            })
          ),
      })
    );

    try {
      const response = await handler(
        mailboxRequest("/api/mailboxes/primary", "PATCH")
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toMatchObject({
        code: "policy_denied",
        message: "Mailbox operation denied",
      });
      expect(JSON.stringify(body)).not.toContain("manage_settings");
    } finally {
      await dispose();
    }
  });
});
