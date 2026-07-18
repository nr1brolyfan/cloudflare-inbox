import * as Schema from "effect/Schema";

import { MailboxRecordSchema } from "../http/mailboxes";
import type { MailboxRecord } from "../http/mailboxes";

export interface BackendBinding {
  readonly fetch: (request: Request) => Promise<Response>;
}

export interface MailboxPublicError {
  readonly _tag: string;
  readonly code: string;
  readonly message: string;
}

export type MailboxServerResult =
  | { readonly mailbox: MailboxRecord; readonly ok: true }
  | {
      readonly error: MailboxPublicError;
      readonly ok: false;
      readonly status: number;
    };

interface ForwardMailboxMutationInput {
  readonly backend: BackendBinding;
  readonly incoming: Request;
  readonly method: "PATCH" | "POST";
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

export const forwardMailboxMutation = async (
  input: ForwardMailboxMutationInput
): Promise<MailboxServerResult> => {
  const headers = new Headers({ "content-type": "application/json" });
  for (const name of forwardedHeaderNames) {
    const value = input.incoming.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }

  const url = new URL(input.path, input.incoming.url);
  const response = await input.backend.fetch(
    new Request(url, {
      body: JSON.stringify(input.payload),
      headers,
      method: input.method,
    })
  );
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return invalidBackendResponse();
  }

  if (response.ok) {
    try {
      return {
        mailbox: Schema.decodeUnknownSync(MailboxRecordSchema)(body),
        ok: true,
      };
    } catch {
      return invalidBackendResponse();
    }
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
};
