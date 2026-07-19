import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Inbox as InboxIcon, LoaderCircle } from "lucide-react";

import {
  authClient,
  authSessionQueryKey,
  clearCachedAuthSession,
  currentSessionForQuery,
} from "../auth/client";
import { MailboxShell } from "../inbox/mailbox-shell";

export const Route = createFileRoute("/inbox")({
  component: InboxRoute,
});

function InboxRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: authSessionQueryKey,
    queryFn: ({ signal }) => currentSessionForQuery(signal),
    retry: false,
  });
  const logout = useMutation({
    mutationFn: () => authClient.session.logout(),
    retry: false,
    onSuccess: async () => {
      await clearCachedAuthSession(queryClient);
      await navigate({ to: "/" });
    },
  });

  if (session.isLoading) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-[var(--sea-ink-soft)]">
        <LoaderCircle aria-label="Loading mailbox" className="animate-spin" />
      </main>
    );
  }

  if (!session.data) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-5 py-10">
        <section className="island-shell w-full max-w-md rounded-[2rem] p-8 text-center sm:p-10">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[var(--sand)] text-[var(--palm)]">
            <InboxIcon size={26} />
          </span>
          <p className="island-kicker mt-7">Private workspace</p>
          <h1 className="display-title mt-2 text-3xl font-bold">
            Sign in to open your inbox
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--sea-ink-soft)]">
            Your mailbox is available only after the current session is
            verified.
          </p>
          <Link
            to="/"
            className="mt-7 inline-flex items-center gap-2 rounded-xl bg-[var(--sea-ink)] px-5 py-3 text-sm font-bold text-white no-underline hover:text-white"
          >
            <ArrowLeft size={17} /> Return to sign in
          </Link>
        </section>
      </main>
    );
  }

  return (
    <MailboxShell
      mailboxName="Primary Inbox"
      principalLabel={session.data.userId}
      isSigningOut={logout.isPending}
      onSignOut={() => logout.mutate()}
    >
      <section className="flex min-h-full items-center justify-center p-5 sm:p-8 lg:p-12">
        <div className="relative w-full max-w-3xl overflow-hidden rounded-[2rem] border border-[var(--line)] bg-white/62 p-7 shadow-[0_18px_50px_rgba(23,58,64,0.08)] sm:p-11">
          <div className="absolute -top-24 -right-20 size-64 rounded-full bg-[var(--lagoon)]/12 blur-2xl" />
          <div className="relative">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-[var(--sand)] text-[var(--palm)]">
              <InboxIcon size={23} />
            </span>
            <p className="island-kicker mt-7">Mailbox workspace</p>
            <h2 className="display-title mt-2 max-w-xl text-3xl font-bold tracking-tight sm:text-4xl">
              Your inbox has a place to land.
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-[var(--sea-ink-soft)] sm:text-base">
              The responsive workspace is ready. Folder navigation, message
              lists, and conversations will fill this shell without changing its
              edge-secured session boundary.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {["Mailbox navigation", "Message list", "Conversation view"].map(
                (label, index) => (
                  <div
                    key={label}
                    className="rounded-2xl border border-[var(--line)] bg-[var(--foam)]/72 p-4"
                  >
                    <span className="text-[0.62rem] font-extrabold tracking-[0.14em] text-[var(--palm)] uppercase">
                      0{index + 1}
                    </span>
                    <p className="mt-2 text-xs font-extrabold sm:text-sm">
                      {label}
                    </p>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </section>
    </MailboxShell>
  );
}
