import { createFileRoute } from "@tanstack/react-router";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { MailboxInlineAttachmentInput } from "#/modules/mailbox/application/MailboxInlineAttachmentReading";

import { websiteBackend } from "../../../../../../../../server/backend";

const responseHeaders = (contentType: string) => ({
  "cache-control": "private, no-store",
  "content-disposition": "inline",
  "content-security-policy": "default-src 'none'; sandbox",
  "content-type": contentType,
  "cross-origin-resource-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
});

export const mailboxInlineAttachmentResponse = async (
  request: Request,
  params: {
    readonly attachmentId: string;
    readonly mailboxId: string;
    readonly messageId: string;
  }
) => {
  const url = new URL(request.url);
  if (
    request.headers.get("sec-fetch-dest") !== "image" ||
    request.headers.get("sec-fetch-site") !== "same-origin"
  ) {
    return new Response(null, {
      headers: responseHeaders("text/plain; charset=utf-8"),
      status: 403,
    });
  }

  const folder = url.searchParams.get("folder") ?? undefined;
  const label = url.searchParams.get("label") ?? undefined;
  if ((folder === undefined) === (label === undefined)) {
    return new Response(null, {
      headers: responseHeaders("text/plain; charset=utf-8"),
      status: 400,
    });
  }
  const decoded = Schema.decodeUnknownExit(MailboxInlineAttachmentInput)(
    folder === undefined
      ? {
          _tag: "Label",
          attachmentId: params.attachmentId,
          labelId: label,
          mailboxId: params.mailboxId,
          messageId: params.messageId,
        }
      : {
          _tag: "Folder",
          attachmentId: params.attachmentId,
          folderId: folder,
          mailboxId: params.mailboxId,
          messageId: params.messageId,
        }
  );
  if (Exit.isFailure(decoded)) {
    return new Response(null, {
      headers: responseHeaders("text/plain; charset=utf-8"),
      status: 400,
    });
  }

  const headers = new Headers(request.headers);
  headers.set("origin", url.origin);
  const incoming = new Request(request, { headers });
  const result = await websiteBackend
    .getMailboxInlineAttachment(decoded.value, incoming)
    .catch(() => null);
  if (result === null) {
    return new Response(null, {
      headers: responseHeaders("text/plain; charset=utf-8"),
      status: 502,
    });
  }
  if (!result.ok) {
    return new Response(null, {
      headers: responseHeaders("text/plain; charset=utf-8"),
      status: result.status,
    });
  }

  return new Response(new Uint8Array(result.bytes).buffer, {
    headers: {
      ...responseHeaders(result.mimeType),
      "content-length": String(result.bytes.byteLength),
    },
    status: 200,
  });
};

export const Route = createFileRoute(
  "/api/mailboxes/$mailboxId/messages/$messageId/attachments/$attachmentId/inline"
)({
  server: {
    handlers: {
      GET: ({ params, request }) =>
        mailboxInlineAttachmentResponse(request, params),
    },
  },
});
