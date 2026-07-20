import { afterEach, describe, expect, it, vi } from "vitest";

import { mailboxDraftAttachmentUploadResponse } from "#/routes/api/mailboxes/$mailboxId/drafts/$draftId/attachments/$attachmentId/content";
import { websiteBackend } from "#/server/backend";

const params = {
  attachmentId: "attachment-1",
  draftId: "draft-1",
  mailboxId: "primary",
};
const uploadResult = {
  attachment: {
    contentSha256: "a".repeat(64),
    createdAt: 1000,
    draftId: "draft-1",
    expiresAt: 901_000,
    fileName: "brief.pdf",
    id: "attachment-1",
    mailboxId: "primary",
    mimeType: "application/pdf",
    size: 3,
    status: "stored" as const,
    storedAt: 2000,
  },
  draftVersion: 2,
};
const uploadRequest = (site = "same-origin") =>
  new Request(
    "https://inbox.test/api/mailboxes/primary/drafts/draft-1/attachments/attachment-1/content",
    {
      body: new Uint8Array([1, 2, 3]),
      headers: {
        "content-length": "3",
        "content-type": "application/octet-stream",
        cookie: "__Host-session=session-a.secret",
        origin: "https://inbox.test",
        "sec-fetch-site": site,
      },
      method: "PUT",
    }
  );

describe("draft attachment upload route", () => {
  afterEach(() => vi.restoreAllMocks());

  it("forwards exact bytes with forced same-origin identity", async () => {
    const upload = vi
      .spyOn(websiteBackend, "uploadMailboxDraftAttachment")
      .mockResolvedValue({ ok: true, upload: uploadResult });
    const response = await mailboxDraftAttachmentUploadResponse(
      uploadRequest(),
      params
    );
    const [input, incoming] = upload.mock.calls[0] ?? [];

    expect({ input, status: response.status }).toMatchObject({
      input: params,
      status: 200,
    });
    expect(incoming?.headers.get("origin")).toBe("https://inbox.test");
    await expect(incoming?.arrayBuffer()).resolves.toStrictEqual(
      new Uint8Array([1, 2, 3]).buffer
    );
    await expect(response.json()).resolves.toStrictEqual(uploadResult);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects cross-site uploads before Backend access", async () => {
    const upload = vi.spyOn(websiteBackend, "uploadMailboxDraftAttachment");
    const response = await mailboxDraftAttachmentUploadResponse(
      uploadRequest("cross-site"),
      params
    );

    expect(response.status).toBe(403);
    expect(upload).not.toHaveBeenCalled();
    await expect(response.text()).resolves.toBe("");
  });

  it("returns an empty sanitized Backend failure", async () => {
    vi.spyOn(websiteBackend, "uploadMailboxDraftAttachment").mockResolvedValue({
      error: {
        _tag: "AuthConflictError",
        code: "conflict",
        message: "Draft attachment reservation expired",
      },
      ok: false,
      status: 409,
    });
    const response = await mailboxDraftAttachmentUploadResponse(
      uploadRequest(),
      params
    );

    expect(response.status).toBe(409);
    await expect(response.text()).resolves.toBe("");
  });
});
