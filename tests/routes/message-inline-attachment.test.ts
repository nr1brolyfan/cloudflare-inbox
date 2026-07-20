import { afterEach, describe, expect, it, vi } from "vitest";

import { mailboxInlineAttachmentResponse } from "#/routes/api/mailboxes/$mailboxId/messages/$messageId/attachments/$attachmentId/inline";
import { websiteBackend } from "#/server/backend";

const imageRequest = (search = "?folder=inbox") =>
  new Request(
    `https://inbox.test/api/mailboxes/primary/messages/message-1/attachments/attachment-1/inline${search}`,
    {
      headers: {
        cookie: "__Host-session=session-a.secret",
        "sec-fetch-dest": "image",
        "sec-fetch-site": "same-origin",
      },
    }
  );

const params = {
  attachmentId: "attachment-1",
  mailboxId: "primary",
  messageId: "message-1",
};

describe("message inline attachment route", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns authorized bytes with fixed security headers", async () => {
    const getAttachment = vi
      .spyOn(websiteBackend, "getMailboxInlineAttachment")
      .mockResolvedValue({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "image/png",
        ok: true,
      });
    const response = await mailboxInlineAttachmentResponse(
      imageRequest(),
      params
    );
    const [query, incoming] = getAttachment.mock.calls[0] ?? [];

    expect({
      cache: response.headers.get("cache-control"),
      contentDisposition: response.headers.get("content-disposition"),
      contentLength: response.headers.get("content-length"),
      contentType: response.headers.get("content-type"),
      corp: response.headers.get("cross-origin-resource-policy"),
      status: response.status,
    }).toStrictEqual({
      cache: "private, no-store",
      contentDisposition: "inline",
      contentLength: "3",
      contentType: "image/png",
      corp: "same-origin",
      status: 200,
    });
    await expect(response.arrayBuffer()).resolves.toStrictEqual(
      new Uint8Array([1, 2, 3]).buffer
    );
    expect(query).toMatchObject({
      _tag: "Folder",
      attachmentId: "attachment-1",
      folderId: "inbox",
      mailboxId: "primary",
      messageId: "message-1",
    });
    expect(incoming?.headers.get("origin")).toBe("https://inbox.test");
  });

  it("rejects non-image and ambiguous requests before Backend access", async () => {
    const getAttachment = vi.spyOn(
      websiteBackend,
      "getMailboxInlineAttachment"
    );
    const document = await mailboxInlineAttachmentResponse(
      new Request(imageRequest(), {
        headers: { "sec-fetch-dest": "document" },
      }),
      params
    );
    const ambiguous = await mailboxInlineAttachmentResponse(
      imageRequest("?folder=inbox&label=work"),
      params
    );
    const crossSite = await mailboxInlineAttachmentResponse(
      new Request(imageRequest(), {
        headers: {
          "sec-fetch-dest": "image",
          "sec-fetch-site": "cross-site",
        },
      }),
      params
    );

    expect({
      ambiguous: ambiguous.status,
      crossSite: crossSite.status,
      document: document.status,
    }).toStrictEqual({ ambiguous: 400, crossSite: 403, document: 403 });
    expect(getAttachment).not.toHaveBeenCalled();
  });

  it("returns an empty protected error response", async () => {
    vi.spyOn(websiteBackend, "getMailboxInlineAttachment").mockResolvedValue({
      error: {
        _tag: "AuthNotFoundError",
        code: "not_found",
        message: "Mailbox not found",
      },
      ok: false,
      status: 404,
    });
    const response = await mailboxInlineAttachmentResponse(
      imageRequest(),
      params
    );

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
