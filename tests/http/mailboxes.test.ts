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
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi";
import { describe, expect, it } from "vitest";

import {
  CurrentRequestAuthMiddlewareLive,
  RequestSessionAuthenticatorLive,
} from "#/auth/session";
import { MailboxGroup } from "#/http/mailbox-contract";
import { MailboxGroupLive } from "#/http/mailboxes";
import { HttpApiPlatformLive } from "#/http/platform";
import type { MailboxAdministration as MailboxAdministrationService } from "#/mailboxes/administration";
import {
  MailboxAdministration,
  MailboxAdministrationError,
} from "#/mailboxes/administration";
import { MailboxRecordSchema } from "#/mailboxes/core";
import { InboundProcessingSchema, InboundReplay } from "#/mailboxes/inbound";
import { InboundReplayAuthorization } from "#/mailboxes/inbound-replay-authorization-live";
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
      hasAttachments: false,
      id: "message-1",
      read: false,
      recipients: [{ address: "owner@example.test" }],
      sender: { address: "sender@example.test", displayName: "Sender" },
      snippet: "Plain text preview",
      starred: false,
      subject: "Hello",
      threadId: "thread-1",
    },
  ],
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
  method: "GET" | "PATCH" | "POST",
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
  const mutationMethod = method === "PATCH" ? "PATCH" : "POST";

  return new Request(`https://backend.test${path}`, {
    body: JSON.stringify(options.body ?? { displayName: "Recruiting" }),
    headers,
    method: mutationMethod,
  });
};

describe("protected mailbox API", () => {
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
