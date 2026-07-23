import { afterEach, describe, expect, it, vi } from "vitest";

import { WebsiteApplication } from "#/apps/website/WebsiteApplication";
import { mailboxMessageHtmlCspForOrigin } from "#/modules/mailbox/application/MailboxMessageHtmlReading";
import { mailboxMessageHtmlResponse } from "#/routes/api/mailboxes/$mailboxId/messages/$messageId/html";

const iframeRequest = (search = "?folder=inbox") =>
  new Request(
    `https://inbox.test/api/mailboxes/primary/messages/message-1/html${search}`,
    {
      headers: {
        cookie: "__Host-session=session-a.secret",
        "sec-fetch-dest": "iframe",
        "sec-fetch-site": "same-origin",
      },
    }
  );

describe("message HTML iframe route", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns HTML with restrictive browser headers", async () => {
    const getHtml = vi
      .spyOn(WebsiteApplication, "getMailboxMessageHtml")
      .mockResolvedValue({
        html: {
          _tag: "Folder",
          document: "<html><body><p>Hello</p></body></html>",
          folderId: "inbox",
          mailboxId: "primary",
          messageId: "message-1",
        },
        ok: true,
      });
    const response = await mailboxMessageHtmlResponse(iframeRequest(), {
      mailboxId: "primary",
      messageId: "message-1",
    });
    const [query, incoming] = getHtml.mock.calls[0] ?? [];

    expect({
      cache: response.headers.get("cache-control"),
      contentType: response.headers.get("content-type"),
      corp: response.headers.get("cross-origin-resource-policy"),
      csp: response.headers.get("content-security-policy"),
      referrer: response.headers.get("referrer-policy"),
      status: response.status,
    }).toStrictEqual({
      cache: "private, no-store",
      contentType: "text/html; charset=utf-8",
      corp: "same-origin",
      csp: mailboxMessageHtmlCspForOrigin("https://inbox.test"),
      referrer: "no-referrer",
      status: 200,
    });
    await expect(response.text()).resolves.toContain("<p>Hello</p>");
    expect(query).toMatchObject({
      _tag: "Folder",
      folderId: "inbox",
      mailboxId: "primary",
      messageId: "message-1",
    });
    expect(incoming?.headers.get("origin")).toBe("https://inbox.test");
  });

  it("rejects top-level, cross-site, and ambiguous requests before Backend access", async () => {
    const getHtml = vi.spyOn(WebsiteApplication, "getMailboxMessageHtml");
    const topLevel = await mailboxMessageHtmlResponse(
      new Request(
        "https://inbox.test/api/mailboxes/primary/messages/message-1/html?folder=inbox",
        {
          headers: {
            "sec-fetch-dest": "document",
            "sec-fetch-site": "same-origin",
          },
        }
      ),
      { mailboxId: "primary", messageId: "message-1" }
    );
    const ambiguous = await mailboxMessageHtmlResponse(
      iframeRequest("?folder=inbox&label=work"),
      { mailboxId: "primary", messageId: "message-1" }
    );

    expect({
      ambiguous: ambiguous.status,
      topLevel: topLevel.status,
    }).toStrictEqual({ ambiguous: 400, topLevel: 403 });
    const topLevelDocument = await topLevel.text();
    expect({
      hasAccessFailure: topLevelDocument.includes(
        "data-preview-access-failure"
      ),
      hasStatus: topLevelDocument.includes('data-preview-status="403"'),
    }).toStrictEqual({ hasAccessFailure: false, hasStatus: true });
    expect(getHtml).not.toHaveBeenCalled();
  });

  it("renders a safe iframe-local fallback for authorized route failures", async () => {
    vi.spyOn(WebsiteApplication, "getMailboxMessageHtml").mockResolvedValue({
      error: {
        _tag: "AuthUnauthenticatedError",
        code: "unauthenticated",
        message: "Unauthenticated",
      },
      ok: false,
      status: 401,
    });

    const response = await mailboxMessageHtmlResponse(iframeRequest(), {
      mailboxId: "primary",
      messageId: "message-1",
    });

    expect({
      contentType: response.headers.get("content-type"),
      csp: response.headers.get("content-security-policy"),
      status: response.status,
    }).toStrictEqual({
      contentType: "text/html; charset=utf-8",
      csp: mailboxMessageHtmlCspForOrigin("https://inbox.test"),
      status: 401,
    });
    const document = await response.text();
    expect({
      hasAccessFailure: document.includes('data-preview-access-failure="401"'),
      hasDetail: document.includes("Your session ended. Sign in again"),
      hasStatus: document.includes('data-preview-status="401"'),
    }).toStrictEqual({
      hasAccessFailure: true,
      hasDetail: true,
      hasStatus: true,
    });
  });

  it("contains service-binding failures inside the sandbox response", async () => {
    vi.spyOn(WebsiteApplication, "getMailboxMessageHtml").mockRejectedValue(
      new Error("Backend binding failed")
    );

    const response = await mailboxMessageHtmlResponse(iframeRequest(), {
      mailboxId: "primary",
      messageId: "message-1",
    });

    expect({
      csp: response.headers.get("content-security-policy"),
      status: response.status,
    }).toStrictEqual({
      csp: mailboxMessageHtmlCspForOrigin("https://inbox.test"),
      status: 502,
    });
    await expect(response.text()).resolves.toContain(
      "The HTML preview could not be loaded"
    );
  });

  it("keeps request-policy rejection local to the preview", async () => {
    vi.spyOn(WebsiteApplication, "getMailboxMessageHtml").mockResolvedValue({
      error: {
        _tag: "AuthRequestRejectedError",
        code: "request_rejected",
        message: "Request rejected",
      },
      ok: false,
      status: 403,
    });

    const response = await mailboxMessageHtmlResponse(iframeRequest(), {
      mailboxId: "primary",
      messageId: "message-1",
    });
    const document = await response.text();

    expect({
      hasAccessFailure: document.includes("data-preview-access-failure"),
      hasStatus: document.includes('data-preview-status="403"'),
      status: response.status,
    }).toStrictEqual({
      hasAccessFailure: false,
      hasStatus: true,
      status: 403,
    });
  });
});
