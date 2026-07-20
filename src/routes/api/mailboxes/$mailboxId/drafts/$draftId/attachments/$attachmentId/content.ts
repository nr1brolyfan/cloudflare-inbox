import { createFileRoute } from "@tanstack/react-router";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { GetDraftAttachmentInput } from "../../../../../../../../mailboxes/draft-attachments";
import { websiteBackend } from "../../../../../../../../server/backend";

const responseHeaders = {
  "cache-control": "private, no-store",
  "content-type": "application/json; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

export const mailboxDraftAttachmentUploadResponse = async (
  request: Request,
  params: {
    readonly attachmentId: string;
    readonly draftId: string;
    readonly mailboxId: string;
  }
) => {
  const url = new URL(request.url);
  if (
    request.headers.get("sec-fetch-site") !== "same-origin" ||
    request.headers.get("origin") !== url.origin
  ) {
    return new Response(null, { headers: responseHeaders, status: 403 });
  }
  const decoded = Schema.decodeUnknownExit(GetDraftAttachmentInput)({
    attachmentId: params.attachmentId,
    draftId: params.draftId,
    mailboxId: params.mailboxId,
  });
  if (Exit.isFailure(decoded)) {
    return new Response(null, { headers: responseHeaders, status: 400 });
  }
  const headers = new Headers(request.headers);
  headers.set("origin", url.origin);
  const incoming = new Request(request, { headers });
  const result = await websiteBackend
    .uploadMailboxDraftAttachment(decoded.value, incoming)
    .catch(() => null);
  if (result === null) {
    return new Response(null, { headers: responseHeaders, status: 502 });
  }
  return result.ok
    ? Response.json(result.upload, { headers: responseHeaders, status: 200 })
    : new Response(null, {
        headers: responseHeaders,
        status: result.status,
      });
};

export const Route = createFileRoute(
  "/api/mailboxes/$mailboxId/drafts/$draftId/attachments/$attachmentId/content"
)({
  server: {
    handlers: {
      PUT: ({ params, request }) =>
        mailboxDraftAttachmentUploadResponse(request, params),
    },
  },
});
