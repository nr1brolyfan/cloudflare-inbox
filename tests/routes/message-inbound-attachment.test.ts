import { afterEach, describe, expect, it, vi } from "vitest";

import { WebsiteApplication } from "#/apps/website/WebsiteApplication";
import { mailboxInboundAttachmentResponse } from "#/routes/api/mailboxes/$mailboxId/messages/$messageId/attachments/$attachmentId/download";
import { attachmentContentDisposition } from "#/shared/ContentDisposition";

const params = {
  attachmentId: "attachment-1",
  mailboxId: "primary",
  messageId: "message-1",
};
const request = (site = "same-origin") =>
  new Request(
    "https://inbox.test/api/mailboxes/primary/messages/message-1/attachments/attachment-1/download?folder=inbox",
    {
      headers: {
        cookie: "__Host-session=session-a.secret",
        "sec-fetch-site": site,
      },
    }
  );

describe("message inbound attachment route", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns exact bytes and protected download headers", async () => {
    const contentDisposition = attachmentContentDisposition(
      'résumé "Q4"\r\n.pdf'
    );
    const { body } = new Response(new Uint8Array([0, 1, 2, 255]));
    if (body === null) {
      throw new Error("Expected attachment response body");
    }
    vi.spyOn(
      WebsiteApplication,
      "getMailboxInboundAttachment"
    ).mockResolvedValue({
      body,
      contentDisposition,
      contentLength: 4,
      mimeType: "application/pdf",
      ok: true,
    });

    const response = await mailboxInboundAttachmentResponse(request(), params);

    expect({
      cache: response.headers.get("cache-control"),
      contentDisposition: response.headers.get("content-disposition"),
      contentLength: response.headers.get("content-length"),
      contentType: response.headers.get("content-type"),
      corp: response.headers.get("cross-origin-resource-policy"),
      nosniff: response.headers.get("x-content-type-options"),
      status: response.status,
    }).toStrictEqual({
      cache: "private, no-store",
      contentDisposition,
      contentLength: "4",
      contentType: "application/pdf",
      corp: "same-origin",
      nosniff: "nosniff",
      status: 200,
    });
    expect(contentDisposition).toBe(
      "attachment; filename=\"r_sum_ _Q4___.pdf\"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%22Q4%22__.pdf"
    );
    await expect(response.arrayBuffer()).resolves.toStrictEqual(
      new Uint8Array([0, 1, 2, 255]).buffer
    );
  });

  it("rejects cross-site and ambiguous requests before Backend access", async () => {
    const getAttachment = vi.spyOn(
      WebsiteApplication,
      "getMailboxInboundAttachment"
    );
    const crossSite = await mailboxInboundAttachmentResponse(
      request("cross-site"),
      params
    );
    const ambiguous = await mailboxInboundAttachmentResponse(
      new Request(`${request().url}&label=work`),
      params
    );

    expect({
      ambiguous: ambiguous.status,
      crossSite: crossSite.status,
    }).toStrictEqual({ ambiguous: 400, crossSite: 403 });
    expect(getAttachment).not.toHaveBeenCalled();
  });

  it("relays an empty unauthenticated response without metadata", async () => {
    vi.spyOn(
      WebsiteApplication,
      "getMailboxInboundAttachment"
    ).mockResolvedValue({
      error: {
        _tag: "AuthUnauthenticatedError",
        code: "unauthenticated",
        message: "Unauthenticated",
      },
      ok: false,
      status: 401,
    });
    const response = await mailboxInboundAttachmentResponse(request(), params);

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("");
    expect(response.headers.get("content-disposition")).toBeNull();
  });
});
