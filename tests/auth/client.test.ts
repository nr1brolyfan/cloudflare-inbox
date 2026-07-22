import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  authSessionQueryKey,
  clearCachedAuthSession,
  clearCachedMailboxData,
  clearMailboxReadDenial,
  handleMailboxReadDenial,
  mailboxReadDenialQueryKey,
  toAuthSessionQueryData,
} from "#/auth/client";

describe("auth session query cache", () => {
  it("stores unauthenticated state as successful null data", async () => {
    const queryClient = new QueryClient();
    const missingSession: { readonly userId: string } | undefined = undefined;
    queryClient.setQueryData(authSessionQueryKey, { userId: "stale-user" });

    const result = await queryClient.fetchQuery({
      queryKey: authSessionQueryKey,
      queryFn: () => Promise.resolve(toAuthSessionQueryData(missingSession)),
    });

    expect(result).toBeNull();
    expect(queryClient.getQueryState(authSessionQueryKey)?.status).toBe(
      "success"
    );
    expect(queryClient.getQueryData(authSessionQueryKey)).toBeNull();
  });

  it("removes the cached session immediately after logout", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(authSessionQueryKey, { userId: "user-a" });
    queryClient.setQueryData(["mailbox", "navigation", "user-a"], {
      mailbox: "sensitive cached data",
    });
    queryClient.setQueryData(["auth", "passkey-credentials", "user-a"], {
      credentials: [{ id: "passkey-a" }],
    });

    await clearCachedAuthSession(queryClient);

    expect({
      mailbox: queryClient.getQueryData(["mailbox", "navigation", "user-a"]),
      passkeys: queryClient.getQueryData([
        "auth",
        "passkey-credentials",
        "user-a",
      ]),
      session: queryClient.getQueryData(authSessionQueryKey),
    }).toStrictEqual({
      mailbox: undefined,
      passkeys: undefined,
      session: null,
    });
  });

  it("clears mailbox data without ending a valid session", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(authSessionQueryKey, { userId: "user-a" });
    queryClient.setQueryData(["mailbox", "thread", "message-1"], {
      body: "sensitive cached body",
    });

    clearCachedMailboxData(queryClient);

    expect({
      mailbox: queryClient.getQueryData(["mailbox", "thread", "message-1"]),
      session: queryClient.getQueryData(authSessionQueryKey),
    }).toStrictEqual({ mailbox: undefined, session: { userId: "user-a" } });
  });

  it("purges mailbox and session cache after an unauthenticated read", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(authSessionQueryKey, { userId: "user-a" });
    queryClient.setQueryData(["mailbox", "messages"], ["private subject"]);

    await handleMailboxReadDenial(queryClient, { ok: false, status: 401 });

    expect({
      mailbox: queryClient.getQueryData(["mailbox", "messages"]),
      session: queryClient.getQueryData(authSessionQueryKey),
    }).toStrictEqual({ mailbox: undefined, session: null });
  });

  it("purges mailbox data but keeps the session after a forbidden read", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(authSessionQueryKey, { userId: "user-a" });
    queryClient.setQueryData(["mailbox", "messages"], ["private subject"]);

    await handleMailboxReadDenial(queryClient, { ok: false, status: 403 });

    expect({
      denial: queryClient.getQueryData(mailboxReadDenialQueryKey),
      mailbox: queryClient.getQueryData(["mailbox", "messages"]),
      session: queryClient.getQueryData(authSessionQueryKey),
    }).toStrictEqual({
      denial: { status: 403 },
      mailbox: undefined,
      session: { userId: "user-a" },
    });

    clearMailboxReadDenial(queryClient);
    expect(queryClient.getQueryData(mailboxReadDenialQueryKey)).toBeUndefined();
  });

  it("publishes forbidden state to active observers before protected UI can render", async () => {
    const queryClient = new QueryClient();
    const observer = new QueryObserver(queryClient, {
      enabled: false,
      queryKey: mailboxReadDenialQueryKey,
    });
    let denial: unknown;
    const unsubscribe = observer.subscribe((result) => {
      denial = result.data;
    });

    await handleMailboxReadDenial(queryClient, { ok: false, status: 403 });

    expect(denial).toStrictEqual({ status: 403 });
    unsubscribe();
  });
});
