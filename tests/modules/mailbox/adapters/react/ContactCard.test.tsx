// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContactCard } from "#/modules/mailbox/adapters/react/ContactCard";
import type { ContactDetail } from "#/modules/mailbox/domain/MailboxContact";

const detail = {
  address: "friend@example.test",
  displayName: "Friend",
  firstInteractionAt: 1000,
  lastInteractionAt: 2000,
  receivedCount: 3,
  saved: false,
  sentCount: 2,
} as ContactDetail;

describe(ContactCard, () => {
  afterEach(cleanup);

  it("loads relationship details and saves a suggested contact", async () => {
    const loadDetail = vi.fn<() => Promise<ContactDetail>>(() =>
      Promise.resolve(detail)
    );
    const onSave = vi.fn<
      (
        displayName: string | undefined,
        expectedVersion?: number
      ) => Promise<ContactDetail>
    >(() =>
      Promise.resolve({
        ...detail,
        saved: true,
        savedAt: 3000,
        version: 1,
      } as ContactDetail)
    );
    render(
      <ContactCard
        address={{ address: detail.address, displayName: "Friend" }}
        initialSaved={false}
        loadDetail={loadDetail}
        onRemove={() => Promise.resolve()}
        onSave={onSave}
      >
        Friend &lt;friend@example.test&gt;
      </ContactCard>
    );

    fireEvent.click(screen.getByRole("button", { name: /Friend/u }));
    await expect(
      screen.findByText("2 sent · 3 received")
    ).resolves.toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add to contacts" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0]?.[0]).toBe("Friend");
    await expect(screen.findByText("Saved contact")).resolves.toBeTruthy();
    expect(loadDetail).toHaveBeenCalledOnce();
  });
});
