import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import { useEffect } from "react";

import {
  MailboxChangedEvent,
  mailboxRealtimeLeaseMillis,
} from "#/modules/mailbox/domain/MailboxRealtime";
import type {
  MailboxChangeScope,
  MailboxChangedEvent as MailboxChangedEventType,
} from "#/modules/mailbox/domain/MailboxRealtime";

const reconnectMaximumMillis = 30_000;
const leaseRenewalMillis = mailboxRealtimeLeaseMillis - 30_000;
const allScopes: readonly MailboxChangeScope[] = [
  "drafts",
  "messages",
  "navigation",
  "outbound",
  "threads",
  "contacts",
];
const decodeEvent = Schema.decodeUnknownOption(MailboxChangedEvent);

interface MailboxRealtimeIdentity {
  readonly mailboxId: string;
  readonly sessionId: string;
  readonly userId: string;
}

const queryMatchesIdentity = (
  queryKey: readonly unknown[],
  resource: string,
  identity: MailboxRealtimeIdentity
) => {
  if (queryKey[0] !== "mailbox" || queryKey[1] !== resource) {
    return false;
  }
  if (resource === "navigation") {
    return (
      queryKey[2] === identity.userId && queryKey[3] === identity.sessionId
    );
  }
  return (
    queryKey[2] === identity.sessionId && queryKey[3] === identity.mailboxId
  );
};

export const invalidateMailboxChangedEvent = (
  queryClient: QueryClient,
  identity: MailboxRealtimeIdentity,
  event: MailboxChangedEventType
) => {
  const resources = new Set<string>();
  for (const scope of event.scopes) {
    switch (scope) {
      case "drafts": {
        resources.add("drafts");
        break;
      }
      case "messages": {
        resources.add("messages");
        break;
      }
      case "navigation": {
        resources.add("navigation");
        break;
      }
      case "outbound": {
        resources.add("outbound-delivery");
        break;
      }
      case "threads": {
        resources.add("thread");
        break;
      }
      case "contacts": {
        resources.add("contacts");
        break;
      }
      default: {
        break;
      }
    }
  }

  return queryClient.invalidateQueries({
    predicate: (query) =>
      [...resources].some((resource) =>
        queryMatchesIdentity(query.queryKey, resource, identity)
      ),
  });
};

type SocketFactory = (url: string) => WebSocket;
const browserSocketFactory: SocketFactory = (url) => new WebSocket(url);

export function MailboxRealtime({
  mailboxId,
  sessionId,
  socketFactory = browserSocketFactory,
  userId,
}: MailboxRealtimeIdentity & { readonly socketFactory?: SocketFactory }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    let attempt = 0;
    let disposed = false;
    let leaseTimer: number | undefined;
    let reconnectTimer: number | undefined;
    let renewingLease = false;
    let socket: WebSocket | undefined;
    const identity = { mailboxId, sessionId, userId };
    const invalidate = (scopes: readonly MailboxChangeScope[]) =>
      void invalidateMailboxChangedEvent(queryClient, identity, {
        _tag: "MailboxChanged",
        formatVersion: 1,
        scopes,
      });
    const clearTimers = () => {
      if (leaseTimer !== undefined) {
        window.clearTimeout(leaseTimer);
        leaseTimer = undefined;
      }
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
    };
    const scheduleReconnect = (immediate = false) => {
      if (
        disposed ||
        reconnectTimer !== undefined ||
        navigator.onLine === false ||
        document.hidden
      ) {
        return;
      }
      const exponential = Math.min(1000 * 2 ** attempt, reconnectMaximumMillis);
      const delay = immediate
        ? 0
        : Math.round(exponential * (0.8 + Math.random() * 0.4));
      attempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, delay);
    };
    const connect = () => {
      if (disposed || socket !== undefined) {
        return;
      }
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = socketFactory(
        `${protocol}//${window.location.host}/api/mailboxes/${encodeURIComponent(mailboxId)}/events`
      );
      socket.addEventListener("open", () => {
        attempt = 0;
        invalidate(allScopes);
        leaseTimer = window.setTimeout(() => {
          renewingLease = true;
          socket?.close(1000, "Renewing socket lease");
        }, leaseRenewalMillis);
      });
      socket.addEventListener("message", (message) => {
        if (typeof message.data !== "string") {
          return;
        }
        try {
          const event = decodeEvent(JSON.parse(message.data));
          if (event._tag === "Some") {
            invalidate(event.value.scopes);
          }
        } catch {
          // Invalid server frames are ignored and cannot mutate cached data.
        }
      });
      socket.addEventListener("close", () => {
        socket = undefined;
        if (leaseTimer !== undefined) {
          window.clearTimeout(leaseTimer);
          leaseTimer = undefined;
        }
        const reconnectImmediately = renewingLease;
        renewingLease = false;
        scheduleReconnect(reconnectImmediately);
      });
    };
    const resume = () => {
      if (
        !document.hidden &&
        navigator.onLine !== false &&
        socket === undefined
      ) {
        scheduleReconnect(true);
      }
    };

    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    connect();

    return () => {
      disposed = true;
      clearTimers();
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
      socket?.close(1000, "Mailbox subscription ended");
      socket = undefined;
    };
  }, [mailboxId, queryClient, sessionId, socketFactory, userId]);

  return null;
}
