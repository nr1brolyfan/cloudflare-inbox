import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { MailboxRecord } from "../mailboxes/model";
import { BackendClient } from "./backend-client";

export interface MailboxPublicError {
  readonly _tag: string;
  readonly code: string;
  readonly message: string;
}

export type MailboxServerResult =
  | {
      readonly mailbox: Schema.Codec.Encoded<typeof MailboxRecord>;
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

export const forwardMailboxMutation = (
  input: ForwardMailboxMutationInput
): Effect.Effect<MailboxServerResult, never, BackendClient> =>
  Effect.gen(function* () {
    const backend = yield* BackendClient;
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
      const decoded = Schema.decodeUnknownExit(MailboxRecord)(body);
      return Exit.isSuccess(decoded)
        ? {
            mailbox: Schema.encodeSync(MailboxRecord)(decoded.value),
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
