// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DraftList } from "#/modules/mailbox/adapters/react/DraftList";

describe(DraftList, () => {
  afterEach(cleanup);

  it("renders saved drafts and opens one without a document navigation", () => {
    const onOpenDraft = vi.fn<(draftId: string) => void>();
    render(
      <DraftList
        data={{
          items: [
            {
              hasAttachments: true,
              id: "draft/one",
              mailboxId: "primary",
              recipients: [
                { address: "person@example.test", displayName: "Person" },
              ],
              snippet: "Local draft body",
              subject: "Draft subject",
              updatedAt: 1000,
              version: 1,
            },
          ],
        }}
        deliveryId="delivery/one"
        folderId="drafts"
        isLoadingMore={false}
        loadMoreFailed={false}
        onLoadMore={vi.fn<() => void>()}
        onOpenDraft={onOpenDraft}
      />
    );

    const link = screen.getByRole("link", {
      name: "To Person: Draft subject",
    });
    expect({
      attachment: Boolean(screen.getByLabelText("Has attachments")),
      href: link.getAttribute("href"),
      snippet: Boolean(screen.getByText("Local draft body")),
    }).toStrictEqual({
      attachment: true,
      href: "/mail/drafts/draft%2Fone?delivery=delivery%2Fone",
      snippet: true,
    });

    fireEvent.click(link);
    expect(onOpenDraft).toHaveBeenCalledWith("draft/one");
  });

  it("shows an empty state for a mailbox without active drafts", () => {
    render(
      <DraftList
        data={{ items: [] }}
        folderId="drafts"
        isLoadingMore={false}
        loadMoreFailed={false}
        onLoadMore={vi.fn<() => void>()}
        onOpenDraft={vi.fn<(draftId: string) => void>()}
      />
    );

    expect(screen.getByText("No saved drafts")).toBeTruthy();
  });

  it("keeps the drafts workspace visible during the initial fetch", () => {
    render(
      <DraftList
        data={{ items: [] }}
        folderId="drafts"
        isInitialLoading
        isLoadingMore={false}
        loadMoreFailed={false}
        onLoadMore={vi.fn<() => void>()}
        onOpenDraft={vi.fn<(draftId: string) => void>()}
      />
    );

    expect(screen.getByText("Saved drafts")).toBeTruthy();
    expect(screen.getByLabelText("Loading drafts")).toBeTruthy();
    expect(screen.queryByText("No saved drafts")).toBeNull();
  });
});
