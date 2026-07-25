import { createFileRoute } from "@tanstack/react-router";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { WebsiteApplication } from "#/apps/website/WebsiteApplication";
import { MailboxInboundAttachmentInput } from "#/modules/mailbox/application/MailboxInboundAttachmentReading";

const responseHeaders = (contentType: string) => ({
  "cache-control": "private, no-store",
  "content-type": contentType,
  "cross-origin-resource-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
});

export const mailboxInboundAttachmentResponse = async (
  request: Request,
  params: {
    readonly attachmentId: string;
    readonly mailboxId: string;
    readonly messageId: string;
  }
) => {
  const url = new URL(request.url);
  if (request.method !== "GET") {
    return new Response(null, {
      headers: responseHeaders("text/plain; charset=utf-8"),
      status: 405,
    });
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") {
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
  const decoded = Schema.decodeUnknownExit(MailboxInboundAttachmentInput)(
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
  const result = await WebsiteApplication.getMailboxInboundAttachment(
    decoded.value,
    new Request(request, { headers })
  ).catch(() => null);
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

  return new Response(result.body, {
    headers: {
      ...responseHeaders(result.mimeType),
      "content-disposition": result.contentDisposition,
      "content-length": String(result.contentLength),
    },
    status: 200,
  });
};

export const Route = createFileRoute(
  "/api/mailboxes/$mailboxId/messages/$messageId/attachments/$attachmentId/download"
)({
  server: {
    handlers: {
      GET: ({ params, request }) =>
        mailboxInboundAttachmentResponse(request, params),
    },
  },
});
