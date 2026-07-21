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
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi";
import { describe, expect, it } from "vitest";

import {
  CurrentRequestAuthMiddlewareLive,
  RequestSessionAuthenticatorLive,
} from "#/auth/session";
import { MailResourceResolveError } from "#/authorization/resources";
import { MailboxGroup } from "#/http/mailbox-contract";
import { MailboxGroupLive } from "#/http/mailboxes";
import { HttpApiPlatformLive } from "#/http/platform";
import type { MailboxAdministration as MailboxAdministrationService } from "#/mailboxes/administration";
import {
  MailboxAdministration,
  MailboxAdministrationError,
} from "#/mailboxes/administration";
import { MailboxInlineAttachmentReading } from "#/mailboxes/attachment-reading";
import { MailboxRecordSchema, MimeType } from "#/mailboxes/core";
import {
  DraftAttachmentReservationSchema,
  DraftAttachmentUploadResult,
  MailboxDraftAttachments,
} from "#/mailboxes/draft-attachments";
import {
  DraftEditorDraft,
  MailboxDraftEditing,
} from "#/mailboxes/draft-editing";
import {
  MailboxDraftListResult,
  MailboxDraftReading,
} from "#/mailboxes/draft-reading";
import { InboundProcessingSchema, InboundReplay } from "#/mailboxes/inbound";
import { InboundReplayAuthorization } from "#/mailboxes/inbound-replay-authorization-live";
import {
  MailboxMessageActionResult,
  MailboxMessageActions,
} from "#/mailboxes/message-actions";
import {
  MailboxMessageHtmlReading,
  MailboxMessageHtmlResult,
} from "#/mailboxes/message-html";
import {
  MailboxMessageListResult,
  MailboxMessageReading,
  MailboxMessageReadingError,
  MailboxThreadResult,
} from "#/mailboxes/message-reading";
import {
  MailboxNavigation,
  MailboxNavigationError,
  MailboxNavigationResult,
} from "#/mailboxes/navigation";
import { CurrentMailboxOperationProvenance } from "#/mailboxes/operation-provenance";
import { OutboundDeliverySchema } from "#/mailboxes/outbound";
import {
  GetMailboxOutboundDeliveryResult,
  MailboxOutboundDeliveryReading,
} from "#/mailboxes/outbound-delivery-reading";
import {
  MailboxOutboundSending,
  MailboxOutboundSendingError,
  SendMailboxDraftResult,
} from "#/mailboxes/outbound-sending";

const publicOrigin = "https://inbox.test";
const MailboxTestApi = HttpApi.make("AuthApi").add(MailboxGroup);
const userId = UserId("user-a");
const sessionId = SessionId("session-a");
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
  mailbox: { displayName: "Inbox", id: "primary" },
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

const makeAdministration = (
  overrides: Partial<MailboxAdministrationService> = {}
) =>
  MailboxAdministration.of({
    bootstrapOwner: () => Effect.succeed(mailbox),
    rename: ({ displayName }) =>
      Effect.succeed(
        Schema.decodeUnknownSync(MailboxRecordSchema)({
          ...mailbox,
          displayName,
          version: 2,
        })
      ),
    ...overrides,
  });

const makeHandler = (
  administration: MailboxAdministrationService,
  validate: SessionsService["validate"] = () =>
    Effect.succeed(validatedSession),
  navigation: MailboxNavigation = MailboxNavigation.of({
    getCurrent: Effect.succeed(mailboxNavigation),
  }),
  messageReading: MailboxMessageReading = MailboxMessageReading.of({
    listView: () => Effect.succeed(mailboxMessages),
    openThread: () => Effect.succeed(mailboxThread),
    readMessage: () => Effect.die("Unexpected message read"),
  }),
  messageActions: MailboxMessageActions = MailboxMessageActions.of({
    execute: () => Effect.succeed(mailboxMessageAction),
  }),
  messageHtml: MailboxMessageHtmlReading = MailboxMessageHtmlReading.of({
    get: () => Effect.succeed(mailboxMessageHtml),
  }),
  inlineAttachments: MailboxInlineAttachmentReading = MailboxInlineAttachmentReading.of(
    {
      get: () =>
        Effect.succeed({
          bytes: new Uint8Array([1, 2, 3]),
          mimeType: Schema.decodeUnknownSync(MimeType)("image/png"),
        }),
    }
  ),
  draftEditing: MailboxDraftEditing = MailboxDraftEditing.of({
    create: () => Effect.succeed(mailboxDraft),
    get: () => Effect.succeed(mailboxDraft),
    update: () => Effect.succeed(mailboxDraft),
  }),
  draftAttachments: MailboxDraftAttachments = MailboxDraftAttachments.of({
    reserve: () => Effect.succeed(draftAttachment),
    upload: () => Effect.succeed(draftAttachmentUpload),
  }),
  outboundSending: MailboxOutboundSending = MailboxOutboundSending.of({
    send: () => Effect.succeed(mailboxDraftSend),
    undo: () => Effect.succeed(cancelledDelivery),
  }),
  outboundDeliveryReading: MailboxOutboundDeliveryReading = MailboxOutboundDeliveryReading.of(
    {
      get: () => Effect.succeed(mailboxOutboundDelivery),
    }
  ),
  draftReading: MailboxDraftReading = MailboxDraftReading.of({
    list: () => Effect.succeed(mailboxDrafts),
  })
) => {
  const requestAuthLive = Layer.mergeAll(
    Layer.succeed(SessionCookie, makeSessionCookie()),
    Layer.succeed(Sessions, Sessions.of({ validate } as SessionsService)),
    WebCryptoLive(),
    AuthSecretsLive({
      challenge: Redacted.make("challenge-secret"),
      privacy: Redacted.make("privacy-secret"),
      session: Redacted.make("session-secret"),
    })
  );
  const middlewareLive = Layer.mergeAll(
    AuthSchemaErrorMiddlewareLive,
    AuthOriginCheckMiddlewareLive({
      allowMissingOrigin: false,
      allowedOrigins: [publicOrigin],
    }),
    CurrentRequestAuthMiddlewareLive.pipe(
      Layer.provide(
        RequestSessionAuthenticatorLive.pipe(Layer.provide(requestAuthLive))
      )
    )
  );
  const groupLive = MailboxGroupLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(MailboxAdministration, administration),
        Layer.succeed(MailboxNavigation, navigation),
        Layer.succeed(MailboxMessageReading, messageReading),
        Layer.succeed(MailboxMessageActions, messageActions),
        Layer.succeed(MailboxMessageHtmlReading, messageHtml),
        Layer.succeed(MailboxInlineAttachmentReading, inlineAttachments),
        Layer.succeed(MailboxDraftEditing, draftEditing),
        Layer.succeed(MailboxDraftReading, draftReading),
        Layer.succeed(MailboxDraftAttachments, draftAttachments),
        Layer.succeed(MailboxOutboundSending, outboundSending),
        Layer.succeed(MailboxOutboundDeliveryReading, outboundDeliveryReading),
        Layer.succeed(
          InboundReplay,
          InboundReplay.of({
            replay: () => Effect.succeed(replayedProcessing),
          })
        ),
        Layer.succeed(
          InboundReplayAuthorization,
          InboundReplayAuthorization.of({ require: () => Effect.void })
        ),
        requestAuthLive,
        middlewareLive
      )
    )
  );

  return HttpRouter.toWebHandler(
    HttpApiBuilder.layer(MailboxTestApi).pipe(
      Layer.provide(Layer.merge(groupLive, middlewareLive)),
      Layer.provide(HttpApiPlatformLive),
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
  return new Request(`https://backend.test${path}`, {
    body: JSON.stringify(options.body ?? { displayName: "Recruiting" }),
    headers,
    method: mutationMethod,
  });
};

describe("protected mailbox API", () => {
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

      expect({
        read: read.status,
        send: sent.status,
        undo: undone.status,
      }).toStrictEqual({
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
      await expect(
        Promise.all([sent.json(), undone.json(), read.json()])
      ).resolves.toMatchObject([
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
        execute: (command) => {
          actionCommand = command;
          return Effect.succeed(mailboxMessageAction);
        },
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

  it("maps a missing action resource to not found", async () => {
    const { dispose, handler } = makeHandler(
      makeAdministration(),
      undefined,
      undefined,
      undefined,
      MailboxMessageActions.of({
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
        mailbox: { displayName: "Inbox", id: "primary" },
      });
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
