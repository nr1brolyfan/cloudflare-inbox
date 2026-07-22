import { createFileRoute } from "@tanstack/react-router";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import {
  MailboxMessageHtmlInput,
  mailboxMessageHtmlCspForOrigin,
} from "#/modules/mailbox/application/MailboxMessageHtmlReading";

import { websiteBackend } from "../../../../../../server/backend";

const responseHeaders = (contentType: string, origin: string) => ({
  "cache-control": "private, no-store",
  "content-security-policy": mailboxMessageHtmlCspForOrigin(origin),
  "content-type": contentType,
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy":
    "accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
});

const previewFailureDocument = (status: number, accessFailure?: 401 | 403) => {
  const detail =
    status === 401
      ? "Your session ended. Sign in again to load this preview."
      : status === 403
        ? "You do not have access to this HTML preview."
        : status === 404
          ? "This HTML body is no longer available."
          : "The HTML preview could not be loaded.";
  const accessMarker =
    accessFailure === undefined
      ? ""
      : ` data-preview-access-failure="${accessFailure}"`;
  return `<!doctype html><html data-preview-status="${status}"${accessMarker}><head><meta charset="utf-8"><style>body{margin:0;padding:1.25rem;background:#f7f4ec;color:#52676b;font:14px/1.6 system-ui,sans-serif}p{margin:0}</style></head><body><p>${detail}</p></body></html>`;
};

const previewFailureResponse = (
  status: number,
  origin: string,
  accessFailure?: 401 | 403
) =>
  new Response(previewFailureDocument(status, accessFailure), {
    headers: responseHeaders("text/html; charset=utf-8", origin),
    status,
  });

export const mailboxMessageHtmlResponse = async (
  request: Request,
  params: { readonly mailboxId: string; readonly messageId: string }
) => {
  const url = new URL(request.url);
  if (
    request.headers.get("sec-fetch-dest") !== "iframe" ||
    request.headers.get("sec-fetch-site") !== "same-origin"
  ) {
    return previewFailureResponse(403, url.origin);
  }

  const folder = url.searchParams.get("folder") ?? undefined;
  const label = url.searchParams.get("label") ?? undefined;
  if ((folder === undefined) === (label === undefined)) {
    return previewFailureResponse(400, url.origin);
  }
  const decoded = Schema.decodeUnknownExit(MailboxMessageHtmlInput)(
    folder === undefined
      ? {
          _tag: "Label",
          labelId: label,
          mailboxId: params.mailboxId,
          messageId: params.messageId,
        }
      : {
          _tag: "Folder",
          folderId: folder,
          mailboxId: params.mailboxId,
          messageId: params.messageId,
        }
  );
  if (Exit.isFailure(decoded)) {
    return previewFailureResponse(400, url.origin);
  }

  const headers = new Headers(request.headers);
  headers.set("origin", url.origin);
  const incoming = new Request(request, { headers });
  const result = await websiteBackend
    .getMailboxMessageHtml(decoded.value, incoming)
    .catch(() => null);
  if (result === null) {
    return previewFailureResponse(502, url.origin);
  }
  if (!result.ok) {
    const accessFailure =
      result.status === 401
        ? 401
        : result.status === 403 && result.error.code === "policy_denied"
          ? 403
          : undefined;
    return previewFailureResponse(result.status, url.origin, accessFailure);
  }

  return new Response(result.html.document, {
    headers: responseHeaders("text/html; charset=utf-8", url.origin),
    status: 200,
  });
};

export const Route = createFileRoute(
  "/api/mailboxes/$mailboxId/messages/$messageId/html"
)({
  server: {
    handlers: {
      GET: ({ params, request }) => mailboxMessageHtmlResponse(request, params),
    },
  },
});
