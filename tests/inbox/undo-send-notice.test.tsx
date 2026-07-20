// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UndoSendNotice } from "#/inbox/undo-send-notice";

type Undo = ComponentProps<typeof UndoSendNotice>["undo"];

const notice = {
  mailboxId: "primary",
  outboundDeliveryId: "delivery-1",
  sendAt: 11_000,
  serverNow: 1000,
  version: 1,
};

describe(UndoSendNotice, () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("announces the notice and exposes a touch-sized undo action", () => {
    render(
      <UndoSendNotice
        notice={notice}
        onClose={vi.fn<() => void>()}
        onMailboxChanged={vi.fn<() => void>()}
        onUnauthorized={vi.fn<() => void>()}
        undo={vi.fn<Undo>()}
      />
    );

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-atomic")).toBe("true");
    expect(screen.getByRole("button", { name: "Undo" }).className).toContain(
      "min-h-11"
    );
  });

  it("shows a successful undo and refreshes mailbox state", async () => {
    const onMailboxChanged = vi.fn<() => void>();
    render(
      <UndoSendNotice
        notice={notice}
        onClose={vi.fn<() => void>()}
        onMailboxChanged={onMailboxChanged}
        onUnauthorized={vi.fn<() => void>()}
        undo={vi.fn<Undo>().mockResolvedValue({
          delivery: { status: "cancelled" },
          ok: true,
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await screen.findByText("Send undone");
    expect(screen.getByText("Send undone")).toBeTruthy();
    expect(onMailboxChanged).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("retries an ambiguous failure with the exact cancel command", async () => {
    const undo = vi
      .fn<Undo>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ delivery: { status: "cancelled" }, ok: true });
    render(
      <UndoSendNotice
        notice={notice}
        onClose={vi.fn<() => void>()}
        onMailboxChanged={vi.fn<() => void>()}
        onUnauthorized={vi.fn<() => void>()}
        undo={undo}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(undo).toHaveBeenCalledTimes(2));

    expect(undo.mock.calls[1]?.[0]).toStrictEqual(undo.mock.calls[0]?.[0]);
    await screen.findByText("Send undone");
    expect(screen.getByText("Send undone")).toBeTruthy();
  });

  it("treats a server conflict as authoritative expiry", async () => {
    const onMailboxChanged = vi.fn<() => void>();
    render(
      <UndoSendNotice
        notice={notice}
        onClose={vi.fn<() => void>()}
        onMailboxChanged={onMailboxChanged}
        onUnauthorized={vi.fn<() => void>()}
        undo={vi.fn<Undo>().mockResolvedValue({ ok: false, status: 409 })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await screen.findByText("The undo window has expired.");
    expect(screen.getByText("The undo window has expired.")).toBeTruthy();
    expect(onMailboxChanged).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("uses the server-relative window only as a countdown display", () => {
    vi.useFakeTimers();
    render(
      <UndoSendNotice
        notice={{ ...notice, sendAt: 1500 }}
        onClose={vi.fn<() => void>()}
        onMailboxChanged={vi.fn<() => void>()}
        onUnauthorized={vi.fn<() => void>()}
        undo={vi.fn<Undo>()}
      />
    );

    expect(screen.getByText("Sending in 1 second.")).toBeTruthy();
    act(() => vi.advanceTimersByTime(750));

    expect(
      screen.getByText(
        "The undo window may have closed. The server will confirm."
      )
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  });
});
