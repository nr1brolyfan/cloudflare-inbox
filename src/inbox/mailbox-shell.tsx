import {
  Inbox,
  LoaderCircle,
  LogOut,
  Mail,
  Menu,
  PanelLeftClose,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

interface MailboxShellProps {
  readonly children: ReactNode;
  readonly isSigningOut: boolean;
  readonly mailboxName: string;
  readonly onSignOut: () => void;
  readonly principalLabel: string;
}

interface MailboxNavigationProps extends Omit<MailboxShellProps, "children"> {
  readonly onClose?: () => void;
}

function MailboxNavigation({
  isSigningOut,
  mailboxName,
  onClose,
  onSignOut,
  principalLabel,
}: MailboxNavigationProps) {
  return (
    <div className="flex h-full flex-col bg-[var(--sea-ink)] text-white">
      <div className="flex h-20 items-center justify-between border-b border-white/10 px-5">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-white/10 text-[var(--lagoon)]">
            <Mail size={20} strokeWidth={2.25} />
          </span>
          <div>
            <p className="text-[0.62rem] font-extrabold tracking-[0.17em] text-white/48 uppercase">
              Cloudflare
            </p>
            <p className="display-title text-lg leading-tight font-bold">
              Inbox
            </p>
          </div>
        </div>
        {onClose ? (
          <button
            type="button"
            aria-label="Close mailbox navigation"
            onClick={onClose}
            className="flex size-10 items-center justify-center rounded-xl text-white/65 hover:bg-white/10 hover:text-white lg:hidden"
          >
            <PanelLeftClose size={20} />
          </button>
        ) : null}
      </div>

      <div className="px-4 pt-5">
        <div className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/7 px-3 py-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--lagoon)]/18 font-bold text-[var(--lagoon)]">
            {mailboxName.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">
              {mailboxName}
            </span>
            <span className="block truncate text-[0.68rem] text-white/48">
              Primary mailbox
            </span>
          </span>
        </div>
      </div>

      <nav aria-label="Mailbox" className="flex-1 px-4 pt-7">
        <p className="px-3 text-[0.62rem] font-extrabold tracking-[0.16em] text-white/36 uppercase">
          Mail
        </p>
        <a
          href="/inbox"
          aria-current="page"
          className="mt-2 flex items-center gap-3 rounded-xl bg-white px-3.5 py-3 text-sm font-extrabold text-[var(--sea-ink)] no-underline shadow-[0_8px_22px_rgba(0,0,0,0.13)] hover:text-[var(--sea-ink)]"
        >
          <Inbox size={18} />
          Inbox
        </a>
      </nav>

      <div className="border-t border-white/10 p-4">
        <div className="mb-3 flex items-center gap-2 px-2 text-[0.68rem] font-bold text-white/46">
          <ShieldCheck size={14} className="text-[var(--lagoon)]" />
          Private edge workspace
        </div>
        <div className="flex items-center gap-3 rounded-2xl bg-black/10 p-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--lagoon)]/20 text-xs font-extrabold text-[var(--lagoon)]">
            {principalLabel.slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-bold text-white/72">
            {principalLabel}
          </span>
          <button
            type="button"
            aria-label="Sign out"
            disabled={isSigningOut}
            onClick={onSignOut}
            className="flex size-9 shrink-0 items-center justify-center rounded-xl text-white/52 hover:bg-white/10 hover:text-white disabled:opacity-45"
          >
            {isSigningOut ? (
              <LoaderCircle className="animate-spin" size={17} />
            ) : (
              <LogOut size={17} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function MailboxShell({
  children,
  isSigningOut,
  mailboxName,
  onSignOut,
  principalLabel,
}: MailboxShellProps) {
  const [navigationOpen, setNavigationOpen] = useState(false);

  useEffect(() => {
    if (!navigationOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNavigationOpen(false);
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [navigationOpen]);

  return (
    <main className="min-h-dvh p-0 sm:p-3 lg:p-5">
      <div className="mx-auto flex min-h-dvh max-w-[100rem] overflow-hidden bg-[var(--surface-strong)] shadow-[0_28px_90px_rgba(23,58,64,0.16)] backdrop-blur-xl sm:min-h-[calc(100dvh-1.5rem)] sm:rounded-[1.75rem] sm:border sm:border-[var(--line)] lg:min-h-[calc(100dvh-2.5rem)]">
        <aside className="hidden w-72 shrink-0 lg:block">
          <MailboxNavigation
            isSigningOut={isSigningOut}
            mailboxName={mailboxName}
            onSignOut={onSignOut}
            principalLabel={principalLabel}
          />
        </aside>

        {navigationOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              aria-label="Dismiss mailbox navigation"
              onClick={() => setNavigationOpen(false)}
              className="absolute inset-0 bg-[var(--sea-ink)]/46 backdrop-blur-sm"
            />
            <dialog
              open
              aria-label="Mailbox navigation"
              aria-modal="true"
              className="relative m-0 h-full max-h-none w-[min(19rem,88vw)] max-w-none border-0 p-0 shadow-2xl"
            >
              <MailboxNavigation
                isSigningOut={isSigningOut}
                mailboxName={mailboxName}
                onClose={() => setNavigationOpen(false)}
                onSignOut={onSignOut}
                principalLabel={principalLabel}
              />
            </dialog>
          </div>
        ) : null}

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-20 shrink-0 items-center justify-between border-b border-[var(--line)] bg-white/58 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                aria-label="Open mailbox navigation"
                aria-expanded={navigationOpen}
                onClick={() => setNavigationOpen(true)}
                className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] bg-white/70 text-[var(--sea-ink-soft)] hover:bg-white lg:hidden"
              >
                <Menu size={20} />
              </button>
              <div className="min-w-0">
                <p className="text-[0.62rem] font-extrabold tracking-[0.16em] text-[var(--palm)] uppercase">
                  {mailboxName}
                </p>
                <h1 className="display-title truncate text-2xl font-bold tracking-tight sm:text-[1.7rem]">
                  Inbox
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-white/66 py-1.5 pr-3 pl-1.5">
              <span className="flex size-8 items-center justify-center rounded-full bg-[var(--sand)] text-[0.65rem] font-extrabold text-[var(--palm)]">
                {principalLabel.slice(0, 2).toUpperCase()}
              </span>
              <span className="hidden max-w-40 truncate text-xs font-bold text-[var(--sea-ink-soft)] sm:block">
                {principalLabel}
              </span>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </section>
      </div>
    </main>
  );
}
