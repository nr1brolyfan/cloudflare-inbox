import type * as Schema from "effect/Schema";
import {
  Archive,
  Clock3,
  FilePenLine,
  Folder,
  Inbox,
  LoaderCircle,
  LogOut,
  Mail,
  Menu,
  PanelLeftClose,
  Send,
  ShieldCheck,
  ShieldAlert,
  Tag,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type { MailboxNavigationResult } from "../mailboxes/navigation";
import { mailboxViewHref } from "./mailbox-view-links";

type MailboxNavigationData = Schema.Codec.Encoded<
  typeof MailboxNavigationResult
>;
type NavigationFolder = MailboxNavigationData["folders"][number];
type NavigationLabel = MailboxNavigationData["labels"][number];

const folderIconByKind = {
  archive: Archive,
  custom: Folder,
  drafts: FilePenLine,
  inbox: Inbox,
  scheduled: Clock3,
  sent: Send,
  spam: ShieldAlert,
  trash: Trash2,
} satisfies Record<NavigationFolder["kind"], typeof Inbox>;

interface MailboxShellProps {
  readonly children: ReactNode;
  readonly folders: readonly NavigationFolder[];
  readonly headerAction?: ReactNode;
  readonly isSigningOut: boolean;
  readonly labels: readonly NavigationLabel[];
  readonly mailboxName: string;
  readonly onSignOut: () => void;
  readonly outboundDeliveryId?: string;
  readonly principalLabel: string;
  readonly selectedFolderId?: string;
  readonly selectedLabelId?: string;
  readonly signOutError?: string;
  readonly viewTitle: string;
}

interface MailboxNavigationProps extends Omit<
  MailboxShellProps,
  "children" | "viewTitle"
> {
  readonly onClose?: () => void;
}

function MailboxNavigation({
  folders,
  isSigningOut,
  labels,
  mailboxName,
  onClose,
  onSignOut,
  outboundDeliveryId,
  principalLabel,
  selectedFolderId,
  selectedLabelId,
  signOutError,
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

      <nav
        aria-label="Mailbox"
        className="min-h-0 flex-1 overflow-y-auto px-4 pt-7 pb-5"
      >
        <section aria-label="Folders">
          <h2 className="px-3 text-[0.62rem] font-extrabold tracking-[0.16em] text-white/36 uppercase">
            Folders
          </h2>
          <div className="mt-2 space-y-1">
            {folders.map((folder) => {
              const selected = folder.id === selectedFolderId;
              const FolderIcon = folderIconByKind[folder.kind];
              const count =
                folder.kind === "drafts"
                  ? folder.messageCount
                  : folder.unreadCount;
              const countLabel =
                folder.kind === "drafts"
                  ? `${count} drafts`
                  : `${count} unread`;
              return (
                <a
                  key={folder.id}
                  href={mailboxViewHref(
                    { folder: folder.id },
                    undefined,
                    undefined,
                    { delivery: outboundDeliveryId }
                  )}
                  aria-current={selected ? "page" : undefined}
                  title={
                    folder.kind === "drafts"
                      ? `${folder.messageCount} drafts`
                      : `${folder.messageCount} messages`
                  }
                  className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm no-underline ${
                    selected
                      ? "bg-white font-extrabold text-[var(--sea-ink)] shadow-[0_8px_22px_rgba(0,0,0,0.13)] hover:text-[var(--sea-ink)]"
                      : "font-bold text-white/66 hover:bg-white/8 hover:text-white"
                  }`}
                >
                  <span className={selected ? "text-[var(--palm)]" : ""}>
                    <FolderIcon size={17} strokeWidth={2} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                  {count > 0 ? (
                    <span
                      aria-label={countLabel}
                      className={`rounded-full px-2 py-0.5 text-[0.62rem] font-extrabold ${
                        selected
                          ? "bg-[var(--sand)] text-[var(--palm)]"
                          : "bg-white/10 text-white/72"
                      }`}
                    >
                      {count}
                    </span>
                  ) : null}
                </a>
              );
            })}
          </div>
        </section>

        <section aria-label="Labels" className="mt-7">
          <h2 className="px-3 text-[0.62rem] font-extrabold tracking-[0.16em] text-white/36 uppercase">
            Labels
          </h2>
          {labels.length > 0 ? (
            <div className="mt-2 space-y-1">
              {labels.map((label) => {
                const selected = label.id === selectedLabelId;
                return (
                  <a
                    key={label.id}
                    href={mailboxViewHref(
                      { label: label.id },
                      undefined,
                      undefined,
                      { delivery: outboundDeliveryId }
                    )}
                    aria-current={selected ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm no-underline ${
                      selected
                        ? "bg-white font-extrabold text-[var(--sea-ink)] shadow-[0_8px_22px_rgba(0,0,0,0.13)] hover:text-[var(--sea-ink)]"
                        : "font-bold text-white/66 hover:bg-white/8 hover:text-white"
                    }`}
                  >
                    <Tag
                      size={16}
                      className={
                        selected ? "text-[var(--palm)]" : "text-[var(--lagoon)]"
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {label.name}
                    </span>
                  </a>
                );
              })}
            </div>
          ) : (
            <p className="px-3 pt-3 text-xs leading-5 text-white/38">
              No labels yet
            </p>
          )}
        </section>
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
        {signOutError === undefined ? null : (
          <p
            role="alert"
            className="mt-2 px-2 text-[0.68rem] font-bold text-red-200"
          >
            {signOutError}
          </p>
        )}
      </div>
    </div>
  );
}

export function MailboxShell({
  children,
  folders,
  headerAction,
  isSigningOut,
  labels,
  mailboxName,
  onSignOut,
  outboundDeliveryId,
  principalLabel,
  selectedFolderId,
  selectedLabelId,
  signOutError,
  viewTitle,
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
            folders={folders}
            isSigningOut={isSigningOut}
            labels={labels}
            mailboxName={mailboxName}
            onSignOut={onSignOut}
            outboundDeliveryId={outboundDeliveryId}
            principalLabel={principalLabel}
            selectedFolderId={selectedFolderId}
            selectedLabelId={selectedLabelId}
            signOutError={signOutError}
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
                folders={folders}
                isSigningOut={isSigningOut}
                labels={labels}
                mailboxName={mailboxName}
                onClose={() => setNavigationOpen(false)}
                onSignOut={onSignOut}
                outboundDeliveryId={outboundDeliveryId}
                principalLabel={principalLabel}
                selectedFolderId={selectedFolderId}
                selectedLabelId={selectedLabelId}
                signOutError={signOutError}
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
                  {viewTitle}
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {headerAction}
              <div className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-white/66 py-1.5 pr-3 pl-1.5">
                <span className="flex size-8 items-center justify-center rounded-full bg-[var(--sand)] text-[0.65rem] font-extrabold text-[var(--palm)]">
                  {principalLabel.slice(0, 2).toUpperCase()}
                </span>
                <span className="hidden max-w-40 truncate text-xs font-bold text-[var(--sea-ink-soft)] sm:block">
                  {principalLabel}
                </span>
              </div>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </section>
      </div>
    </main>
  );
}
