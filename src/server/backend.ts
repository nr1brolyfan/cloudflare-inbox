import { getRequest } from "@tanstack/react-start/server";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { WebsiteEnv } from "../../alchemy.run.ts";
import type { DevEmailRecord } from "../http/dev-email-contract";
import { DevEmailListSchema } from "../http/dev-email-contract";
import { MailboxRecordSchema } from "../mailboxes/core";

interface WebsitePlatformShape {
  readonly devEmailInboxEnabled: boolean;
  readonly fetch: (operation: string, request: Request) => Promise<Response>;
}

const WebsitePlatform = Context.Service<WebsitePlatformShape>(
  "cloudflare-inbox/WebsitePlatform"
);

const WebsitePlatformLive = Layer.effect(
  WebsitePlatform,
  Effect.promise(async () => {
    const Cloudflare = await import("cloudflare:workers");
    const env = new Proxy({} as WebsiteEnv, {
      get(_, property) {
        return Cloudflare.env[property as keyof typeof Cloudflare.env];
      },
    });

    return WebsitePlatform.of({
      devEmailInboxEnabled: String(env.DEV_EMAIL_INBOX_ENABLED) === "true",
      fetch: (operation, request) =>
        Cloudflare.tracing.enterSpan(operation, (span) => {
          if (span.isTraced) {
            const url = new URL(request.url);
            span.setAttribute("http.request.method", request.method);
            span.setAttribute("url.path", url.pathname);
          }

          return env.BACKEND.fetch(request);
        }),
    });
  })
);

export interface BackendClientShape {
  readonly fetch: (
    operation: string,
    request: Request
  ) => Effect.Effect<Response>;
}

/** Website-side client for the private Backend service binding. */
export const BackendClient = Context.Service<BackendClientShape>(
  "cloudflare-inbox/BackendClient"
);

/** Cloudflare implementation that traces every Website-to-Backend binding call. */
export const BackendClientLive = Layer.effect(
  BackendClient,
  Effect.gen(function* () {
    const platform = yield* WebsitePlatform;
    return BackendClient.of({
      fetch: (operation, request) =>
        Effect.promise(() => platform.fetch(operation, request)),
    });
  })
);

export interface WebsiteConfigShape {
  readonly devEmailInboxEnabled: boolean;
}

/** Website feature configuration read from the Cloudflare environment. */
export const WebsiteConfig = Context.Service<WebsiteConfigShape>(
  "cloudflare-inbox/WebsiteConfig"
);

export const WebsiteConfigLive = Layer.effect(
  WebsiteConfig,
  Effect.gen(function* () {
    const platform = yield* WebsitePlatform;
    return WebsiteConfig.of({
      devEmailInboxEnabled: platform.devEmailInboxEnabled,
    });
  })
);

export interface MailboxPublicError {
  readonly _tag: string;
  readonly code: string;
  readonly message: string;
}

export type MailboxServerResult =
  | {
      readonly mailbox: Schema.Codec.Encoded<typeof MailboxRecordSchema>;
      readonly ok: true;
    }
  | {
      readonly error: MailboxPublicError;
      readonly ok: false;
      readonly status: number;
    };

interface ForwardMailboxMutationInput {
  readonly incoming: Request;
  readonly method: "PATCH" | "POST";
  readonly operation: string;
  readonly path: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

const forwardedHeaderNames = [
  "cookie",
  "origin",
  "referer",
  "user-agent",
] as const;

const publicErrors = {
  bad_request: {
    _tag: "AuthBadRequestError",
    message: "Invalid mailbox request",
    status: 400,
  },
  conflict: {
    _tag: "AuthConflictError",
    message: "Mailbox already exists",
    status: 409,
  },
  internal_error: {
    _tag: "AuthInternalError",
    message: "Mailbox operation failed",
    status: 500,
  },
  not_found: {
    _tag: "AuthNotFoundError",
    message: "Mailbox not found",
    status: 404,
  },
  policy_denied: {
    _tag: "AuthPolicyDeniedError",
    message: "Mailbox operation denied",
    status: 403,
  },
  request_rejected: {
    _tag: "AuthRequestRejectedError",
    message: "Request rejected",
    status: 403,
  },
  unauthenticated: {
    _tag: "AuthUnauthenticatedError",
    message: "Unauthenticated",
    status: 401,
  },
} as const;

const invalidBackendResponse = (): MailboxServerResult => ({
  error: {
    _tag: "AuthInternalError",
    code: "internal_error",
    message: "Invalid Backend response",
  },
  ok: false,
  status: 502,
});

const policyDeniedMessage = (body: object) => {
  if (!("message" in body) || typeof body.message !== "string") {
    return publicErrors.policy_denied.message;
  }

  return body.message === "Mailbox owner account required" ||
    body.message === "Complete account verification and sign in again"
    ? body.message
    : publicErrors.policy_denied.message;
};

export interface MailboxBackendOperationsShape {
  readonly bootstrapOwner: (input: {
    readonly displayName: string;
    readonly incoming: Request;
  }) => Effect.Effect<MailboxServerResult>;
  readonly rename: (input: {
    readonly displayName: string;
    readonly incoming: Request;
    readonly mailboxId: string;
  }) => Effect.Effect<MailboxServerResult>;
}

/** Website mailbox use cases backed by the private Backend binding. */
export const MailboxBackendOperations =
  Context.Service<MailboxBackendOperationsShape>(
    "cloudflare-inbox/MailboxBackendOperations"
  );

export const MailboxBackendOperationsLive = Layer.effect(
  MailboxBackendOperations,
  Effect.gen(function* () {
    const backend = yield* BackendClient;
    const forwardMutation = (
      input: ForwardMailboxMutationInput
    ): Effect.Effect<MailboxServerResult> =>
      Effect.gen(function* () {
        const headers = new Headers({ "content-type": "application/json" });
        for (const name of forwardedHeaderNames) {
          const value = input.incoming.headers.get(name);
          if (value !== null) {
            headers.set(name, value);
          }
        }

        const url = new URL(input.path, input.incoming.url);
        const response = yield* backend.fetch(
          input.operation,
          new Request(url, {
            body: JSON.stringify(input.payload),
            headers,
            method: input.method,
          })
        );
        const bodyOption = yield* Effect.tryPromise(() => response.json()).pipe(
          Effect.option
        );

        if (Option.isNone(bodyOption)) {
          return invalidBackendResponse();
        }
        const body = bodyOption.value;

        if (response.ok) {
          const decoded = Schema.decodeUnknownExit(MailboxRecordSchema)(body);
          return Exit.isSuccess(decoded)
            ? {
                mailbox: Schema.encodeSync(MailboxRecordSchema)(decoded.value),
                ok: true,
              }
            : invalidBackendResponse();
        }

        if (
          typeof body !== "object" ||
          body === null ||
          !("code" in body) ||
          typeof body.code !== "string" ||
          !(body.code in publicErrors)
        ) {
          return invalidBackendResponse();
        }

        const definition = publicErrors[body.code as keyof typeof publicErrors];
        const message =
          body.code === "policy_denied"
            ? policyDeniedMessage(body)
            : definition.message;
        return response.status === definition.status
          ? {
              error: {
                _tag: definition._tag,
                code: body.code,
                message,
              },
              ok: false,
              status: response.status,
            }
          : invalidBackendResponse();
      });

    return MailboxBackendOperations.of({
      bootstrapOwner: ({ displayName, incoming }) =>
        forwardMutation({
          incoming,
          method: "POST",
          operation: "website.mailbox.bootstrap",
          path: "/api/mailboxes/bootstrap-owner",
          payload: { displayName },
        }),
      rename: ({ displayName, incoming, mailboxId }) =>
        forwardMutation({
          incoming,
          method: "PATCH",
          operation: "website.mailbox.rename",
          path: `/api/mailboxes/${encodeURIComponent(mailboxId)}`,
          payload: { displayName },
        }),
    });
  })
);

export type DevEmailInboxResult =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly messages: readonly DevEmailRecord[] };

export interface DevEmailOperationsShape {
  readonly clear: (
    incoming: Request
  ) => Effect.Effect<{ readonly enabled: boolean }>;
  readonly list: (incoming: Request) => Effect.Effect<DevEmailInboxResult>;
  readonly status: Effect.Effect<{ readonly enabled: boolean }>;
}

/** Development-inbox use cases, including the deployment feature gate. */
export const DevEmailOperations = Context.Service<DevEmailOperationsShape>(
  "cloudflare-inbox/DevEmailOperations"
);

export const DevEmailOperationsLive = Layer.effect(
  DevEmailOperations,
  Effect.gen(function* () {
    const backend = yield* BackendClient;
    const config = yield* WebsiteConfig;
    const requestBackend = (incoming: Request, method: "DELETE" | "GET") =>
      Effect.gen(function* () {
        const url = new URL("/api/dev-emails", incoming.url);
        const response = yield* backend.fetch(
          "website.dev_email.backend",
          new Request(url, { method })
        );

        if (!response.ok) {
          return yield* Effect.die(
            new Error("Development email inbox is unavailable")
          );
        }

        return response;
      });

    return DevEmailOperations.of({
      clear: (incoming) =>
        config.devEmailInboxEnabled
          ? requestBackend(incoming, "DELETE").pipe(
              Effect.as({ enabled: true as const })
            )
          : Effect.succeed({ enabled: false as const }),
      list: (incoming) =>
        config.devEmailInboxEnabled
          ? requestBackend(incoming, "GET").pipe(
              Effect.flatMap((response) =>
                Effect.promise(() => response.json())
              ),
              Effect.map(Schema.decodeUnknownSync(DevEmailListSchema)),
              Effect.map((body) => ({
                enabled: true as const,
                messages: body.messages,
              }))
            )
          : Effect.succeed({ enabled: false as const }),
      status: Effect.succeed({ enabled: config.devEmailInboxEnabled }),
    });
  })
);

/** Complete Website-side service graph, built once without request-bound state. */
const websitePlatformServicesLive = Layer.merge(
  BackendClientLive,
  WebsiteConfigLive
).pipe(Layer.provide(WebsitePlatformLive));

export const WebsiteLive = Layer.merge(
  MailboxBackendOperationsLive,
  DevEmailOperationsLive
).pipe(Layer.provideMerge(websitePlatformServicesLive));

const websiteRuntime = ManagedRuntime.make(WebsiteLive);

/** Promise facade used by TanStack adapters; all Effect execution stays here. */
export const websiteBackend = {
  bootstrapMailboxOwner: (displayName: string) =>
    websiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* MailboxBackendOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.bootstrapOwner({ displayName, incoming });
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
  listDevEmails: () =>
    websiteRuntime.runPromise(
      Effect.gen(function* () {
        const operations = yield* DevEmailOperations;
        const incoming = yield* Effect.sync(getRequest);
        return yield* operations.list(incoming);
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
} as const;
