// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

import {
  OutboundDeliveryTracker,
  outboundDeliveryQueryKey,
} from "#/modules/mailbox/adapters/react/OutboundDeliveryTracker";
import type {
  OutboundDeliverySnapshot,
  OutboundDeliveryView,
} from "#/modules/mailbox/adapters/react/OutboundDeliveryTracker";
import type { OutboundFailureCode } from "#/modules/mailbox/domain/MailboxOutbound";

type TrackerProps = ComponentProps<typeof OutboundDeliveryTracker>;
type GetStatus = TrackerProps["getStatus"];
type Undo = TrackerProps["undo"];

const scheduled: OutboundDeliveryView = {
  attemptCount: 0,
  id: "delivery-1",
  mailboxId: "primary",
  sendAt: 11_000,
  status: "scheduled",
  version: 1,
};

const snapshot = (
  delivery: OutboundDeliveryView = scheduled,
  serverNow = 1000
): OutboundDeliverySnapshot => ({ delivery, serverNow });

const queryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { gcTime: Number.POSITIVE_INFINITY, retry: false },
    },
  });

const renderTracker = (
  overrides: Partial<TrackerProps> = {},
  client = queryClient()
) => {
  const props: TrackerProps = {
    deliveryId: "delivery-1",
    getStatus: vi.fn<GetStatus>().mockResolvedValue({
      ok: true,
      outbound: snapshot(),
    }),
    mailboxId: "primary",
    onDismiss: vi.fn<() => void>(),
    onMailboxChanged: vi.fn<() => void>(),
    onUnauthorized: vi.fn<() => void>(),
    sessionId: "session-1",
    undo: vi.fn<Undo>(),
    ...overrides,
  };
  const view = render(
    <QueryClientProvider client={client}>
      <OutboundDeliveryTracker {...props} />
    </QueryClientProvider>
  );
  return { ...view, client, props };
};

describe(OutboundDeliveryTracker, () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("announces a scheduled send with touch-sized actions", async () => {
    const { props } = renderTracker();

    await screen.findByText("Send scheduled");
    expect(screen.getByText("Send scheduled")).toBeTruthy();
    const status = screen.getByRole("status");
    expect({
      atomic: status.getAttribute("aria-atomic"),
      live: status.getAttribute("aria-live"),
    }).toStrictEqual({ atomic: "true", live: "polite" });
    expect(screen.getByRole("button", { name: "Undo" }).className).toContain(
      "min-h-11"
    );
    expect(
      screen.getByRole("button", { name: "Dismiss delivery status" }).className
    ).toContain("min-h-11");
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss delivery status" })
    );
    expect(props.onDismiss).toHaveBeenCalledOnce();
  });

  it("hides undo at the server-relative deadline and waits for status", () => {
    vi.useFakeTimers();
    vi.setSystemTime(50_000);
    const client = queryClient();
    client.setQueryData(
      outboundDeliveryQueryKey("session-1", "primary", "delivery-1"),
      snapshot({ ...scheduled, sendAt: 2000 })
    );
    renderTracker(
      {
        getStatus: vi.fn<GetStatus>().mockResolvedValue({
          ok: true,
          outbound: snapshot({ ...scheduled, sendAt: 2000 }),
        }),
      },
      client
    );

    expect(screen.getByText("Sending in 1 second.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1100));
    expect(screen.getByText("Waiting to send")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.getByRole("button", { name: "Check status" })).toBeTruthy();
  });

  it("refreshes the mailbox and dismisses an accepted send", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn<() => void>();
    const onMailboxChanged = vi.fn<() => void>();
    const client = queryClient();
    client.setQueryData(
      outboundDeliveryQueryKey("session-1", "primary", "delivery-1"),
      snapshot({ ...scheduled, status: "accepted" })
    );
    renderTracker(
      {
        getStatus: vi.fn<GetStatus>().mockResolvedValue({
          ok: true,
          outbound: snapshot({ ...scheduled, status: "accepted" }),
        }),
        onDismiss,
        onMailboxChanged,
      },
      client
    );

    expect(onMailboxChanged).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(3000));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("uses the exact cancellation command when an ambiguous undo is retried", async () => {
    const onMailboxChanged = vi.fn<() => void>();
    const undo = vi
      .fn<Undo>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({
        delivery: { ...scheduled, status: "cancelled", version: 2 },
        ok: true,
      });
    renderTracker({ onMailboxChanged, undo });

    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry undo" }));
    await waitFor(() => expect(undo).toHaveBeenCalledTimes(2));

    expect(undo.mock.calls[1]?.[0]).toStrictEqual(undo.mock.calls[0]?.[0]);
    await screen.findByText("Send cancelled");
    expect(screen.getByText("Send cancelled")).toBeTruthy();
    expect(onMailboxChanged).toHaveBeenCalledOnce();
  });

  it("refetches authoritative status after a late undo conflict", async () => {
    const getStatus = vi
      .fn<GetStatus>()
      .mockResolvedValueOnce({ ok: true, outbound: snapshot() })
      .mockResolvedValueOnce({
        ok: true,
        outbound: snapshot(
          { ...scheduled, status: "sending", version: 2 },
          11_100
        ),
      });
    renderTracker({
      getStatus,
      undo: vi.fn<Undo>().mockResolvedValue({ ok: false, status: 409 }),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));

    await screen.findByText("Sending");
    expect(screen.getByText("Sending")).toBeTruthy();
    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/expired/iu)).toBeNull();
  });

  it("distinguishes retry scheduling and provider acceptance", async () => {
    const getStatus = vi
      .fn<GetStatus>()
      .mockResolvedValueOnce({
        ok: true,
        outbound: snapshot({ ...scheduled, attemptCount: 2 }, 5000),
      })
      .mockResolvedValueOnce({
        ok: true,
        outbound: snapshot({ ...scheduled, status: "accepted" }, 11_000),
      });
    const { unmount } = renderTracker({ getStatus });

    await screen.findByText("Retrying delivery");
    expect(screen.getByText("Retrying delivery")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    unmount();
    renderTracker({
      getStatus: vi.fn<GetStatus>().mockResolvedValue({
        ok: true,
        outbound: snapshot({ ...scheduled, status: "accepted" }, 11_000),
      }),
    });
    await screen.findByText("Accepted by provider");
    expect(screen.getByText("Accepted by provider")).toBeTruthy();
    expect(
      screen.getByText(/does not confirm recipient delivery/iu)
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Check status" })).toBeNull();
  });

  it.each([
    ["invalid_message", "content is invalid"],
    ["message_too_large", "too large"],
    ["invalid_sender", "sender address is not valid"],
    ["recipient_suppressed", "suppressed"],
    ["provider_rejected", "provider rejected"],
    ["preparation_failed", "could not be prepared"],
    ["temporary_provider_failure", "temporary failure"],
    ["provider_unavailable", "provider was unavailable"],
    ["retry_exhausted", "all automatic retry attempts"],
  ] satisfies readonly (readonly [OutboundFailureCode, string])[])(
    "renders the %s failure",
    async (code, expected) => {
      renderTracker({
        getStatus: vi.fn<GetStatus>().mockResolvedValue({
          ok: true,
          outbound: snapshot({
            ...scheduled,
            failure: { code },
            status: "failed",
          }),
        }),
      });

      await screen.findByText("Delivery failed");
      expect(screen.getByText("Delivery failed")).toBeTruthy();
      expect(screen.getByRole("alert").textContent).toMatch(
        new RegExp(expected, "iu")
      );
    }
  );

  it.each([
    [
      "indeterminate",
      "Delivery could not be confirmed",
      "could create a duplicate",
    ],
    ["cancelled", "Send cancelled", "cancelled before provider submission"],
    ["delivered", "Delivered", "reported that the message was delivered"],
    ["bounced", "Message bounced", "reported that the message bounced"],
  ] as const)("renders the %s state", async (status, title, detail) => {
    renderTracker({
      getStatus: vi.fn<GetStatus>().mockResolvedValue({
        ok: true,
        outbound: snapshot({ ...scheduled, status }),
      }),
    });

    await screen.findByText(title);
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText(new RegExp(detail, "iu"))).toBeTruthy();
  });

  it.each([
    [403, "do not have permission"],
    [404, "could not be found"],
  ] as const)("stops on a %s status response", async (status, expected) => {
    const getStatus = vi
      .fn<GetStatus>()
      .mockResolvedValue({ ok: false, status });
    renderTracker({ getStatus });

    await screen.findByText(new RegExp(expected, "iu"));
    expect(screen.getByText(new RegExp(expected, "iu"))).toBeTruthy();
    expect(getStatus).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Check status" })).toBeNull();
  });

  it("clears authorization state on a 401", async () => {
    const onUnauthorized = vi.fn<() => void>();
    renderTracker({
      getStatus: vi
        .fn<GetStatus>()
        .mockResolvedValue({ ok: false, status: 401 }),
      onUnauthorized,
    });

    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledOnce());
    expect(screen.getByText(/session ended/iu)).toBeTruthy();
  });

  it("preserves the last status across a transient refetch failure", async () => {
    const getStatus = vi
      .fn<GetStatus>()
      .mockResolvedValueOnce({
        ok: true,
        outbound: snapshot({ ...scheduled, status: "accepted" }),
      })
      .mockRejectedValueOnce(new Error("network"));
    const { client } = renderTracker({ getStatus });

    await screen.findByText("Accepted by provider");
    await client.refetchQueries({
      queryKey: outboundDeliveryQueryKey("session-1", "primary", "delivery-1"),
    });

    await screen.findByText(/last known status is still shown/iu);
    expect(screen.getByText(/last known status is still shown/iu)).toBeTruthy();
    expect(screen.getByText("Accepted by provider")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check status" })).toBeTruthy();
  });

  it("preserves cached status and offers retry after a 5xx response", async () => {
    const client = queryClient();
    client.setQueryData(
      outboundDeliveryQueryKey("session-1", "primary", "delivery-1"),
      snapshot({ ...scheduled, status: "accepted" })
    );
    renderTracker(
      {
        getStatus: vi
          .fn<GetStatus>()
          .mockResolvedValue({ ok: false, status: 503 }),
      },
      client
    );

    await screen.findByText(/last known status is still shown/iu);
    expect(screen.getByText("Accepted by provider")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check status" })).toBeTruthy();
  });
});

describe(outboundDeliveryQueryKey, () => {
  it("isolates query data by session identity", () => {
    expect(
      outboundDeliveryQueryKey("session-a", "mailbox", "delivery")
    ).not.toStrictEqual(
      outboundDeliveryQueryKey("session-b", "mailbox", "delivery")
    );
  });
});
