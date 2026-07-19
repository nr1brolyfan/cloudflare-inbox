import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { MailboxPublicError } from "../http/mailbox-contract";
import { MailboxPublicErrorSchema } from "../http/mailbox-contract";
import { MailboxRecordSchema } from "../mailboxes/core";
import { MailboxNavigationResult } from "../mailboxes/navigation";
import { BackendClient } from "./website-platform";

export interface MailboxServerErrorResult {
  readonly error: MailboxPublicError;
  readonly ok: false;
  readonly status: number;
}

export type MailboxServerResult =
  | {
      readonly mailbox: Schema.Codec.Encoded<typeof MailboxRecordSchema>;
      readonly ok: true;
    }
  | MailboxServerErrorResult;

export type MailboxNavigationServerResult =
  | {
      readonly navigation: Schema.Codec.Encoded<typeof MailboxNavigationResult>;
      readonly ok: true;
    }
  | MailboxServerErrorResult;

interface ForwardMailboxRequestInput {
  readonly incoming: Request;
  readonly method: "GET" | "PATCH" | "POST";
  readonly operation: string;
  readonly path: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

type ForwardMailboxResult =
  | { readonly body: unknown; readonly ok: true }
  | MailboxServerErrorResult;

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

const isPublicErrorCode = (code: string): code is keyof typeof publicErrors =>
  Object.hasOwn(publicErrors, code);

const invalidBackendResponse = (): MailboxServerErrorResult => ({
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
  readonly getNavigation: (
    incoming: Request
  ) => Effect.Effect<MailboxNavigationServerResult>;
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
    const forwardRequest = (
      input: ForwardMailboxRequestInput
    ): Effect.Effect<ForwardMailboxResult> =>
      Effect.gen(function* () {
        const headers = new Headers();
        if (input.payload !== undefined) {
          headers.set("content-type", "application/json");
        }
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
            body:
              input.payload === undefined
                ? undefined
                : JSON.stringify(input.payload),
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
          return { body, ok: true };
        }

        const decodedError = Schema.decodeUnknownExit(MailboxPublicErrorSchema)(
          body
        );
        if (
          Exit.isFailure(decodedError) ||
          !isPublicErrorCode(decodedError.value.code)
        ) {
          return invalidBackendResponse();
        }

        const publicError = decodedError.value;
        const encodedError = yield* Schema.encodeEffect(
          MailboxPublicErrorSchema
        )(publicError).pipe(Effect.orDie);
        const definition = publicErrors[encodedError.code];
        const message =
          encodedError.code === "policy_denied"
            ? policyDeniedMessage(encodedError)
            : definition.message;
        const sanitizedError = yield* Schema.decodeUnknownEffect(
          MailboxPublicErrorSchema
        )({ ...encodedError, message }).pipe(
          Effect.flatMap(Schema.encodeEffect(MailboxPublicErrorSchema)),
          Effect.orDie
        );
        return response.status === definition.status
          ? {
              error: sanitizedError,
              ok: false,
              status: response.status,
            }
          : invalidBackendResponse();
      });

    return MailboxBackendOperations.of({
      bootstrapOwner: ({ displayName, incoming }) =>
        forwardRequest({
          incoming,
          method: "POST",
          operation: "website.mailbox.bootstrap",
          path: "/api/mailboxes/bootstrap-owner",
          payload: { displayName },
        }).pipe(
          Effect.map((result): MailboxServerResult => {
            if (!result.ok) {
              return result;
            }
            const decoded = Schema.decodeUnknownExit(MailboxRecordSchema)(
              result.body
            );
            return Exit.isSuccess(decoded)
              ? {
                  mailbox: Schema.encodeSync(MailboxRecordSchema)(
                    decoded.value
                  ),
                  ok: true,
                }
              : invalidBackendResponse();
          })
        ),
      getNavigation: (incoming) =>
        forwardRequest({
          incoming,
          method: "GET",
          operation: "website.mailbox.navigation",
          path: "/api/mailboxes/current/navigation",
        }).pipe(
          Effect.map((result): MailboxNavigationServerResult => {
            if (!result.ok) {
              return result;
            }
            const decoded = Schema.decodeUnknownExit(MailboxNavigationResult)(
              result.body
            );
            return Exit.isSuccess(decoded)
              ? {
                  navigation: Schema.encodeSync(MailboxNavigationResult)(
                    decoded.value
                  ),
                  ok: true,
                }
              : invalidBackendResponse();
          })
        ),
      rename: ({ displayName, incoming, mailboxId }) =>
        forwardRequest({
          incoming,
          method: "PATCH",
          operation: "website.mailbox.rename",
          path: `/api/mailboxes/${encodeURIComponent(mailboxId)}`,
          payload: { displayName },
        }).pipe(
          Effect.map((result): MailboxServerResult => {
            if (!result.ok) {
              return result;
            }
            const decoded = Schema.decodeUnknownExit(MailboxRecordSchema)(
              result.body
            );
            return Exit.isSuccess(decoded)
              ? {
                  mailbox: Schema.encodeSync(MailboxRecordSchema)(
                    decoded.value
                  ),
                  ok: true,
                }
              : invalidBackendResponse();
          })
        ),
    });
  })
);
