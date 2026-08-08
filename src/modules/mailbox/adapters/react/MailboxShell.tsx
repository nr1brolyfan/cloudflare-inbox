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
  Settings as SettingsIcon,
  ShieldCheck,
  ShieldAlert,
  Tag,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

import type { MailboxViewSelection } from "./MailboxViewLinks";
import { mailboxViewHref } from "./MailboxViewLinks";
import { ThemeToggle } from "./ThemeProvider";

interface NavigationFolder {
  readonly id: string;
  readonly kind:
    | "archive"
    | "custom"
    | "drafts"
    | "inbox"
    | "scheduled"
    | "sent"
    | "spam"
    | "trash";
  readonly messageCount: number;
  readonly name: string;
  readonly unreadCount: number;
}

interface NavigationLabel {
  readonly id: string;
  readonly name: string;
}

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
  readonly mailboxAddress: string;
  readonly mailboxName: string;
  readonly onNavigate: (selection: MailboxViewSelection) => void;
  readonly onPrefetch: (selection: MailboxViewSelection) => void;
  readonly onSignOut: () => void;
  readonly onSettingsNavigate: () => void;
  readonly outboundDeliveryId?: string;
  readonly principalLabel: string;
  readonly selectedFolderId?: string;
  readonly selectedLabelId?: string;
  readonly signOutError?: string;
  readonly settingsSelected: boolean;
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
  mailboxAddress,
  mailboxName,
  onClose,
  onNavigate,
  onPrefetch,
  onSignOut,
  onSettingsNavigate,
  outboundDeliveryId,
  principalLabel,
  selectedFolderId,
  selectedLabelId,
  signOutError,
  settingsSelected,
}: MailboxNavigationProps) {
  return (
    <div className="flex h-full flex-col bg-[var(--nav-bg)] text-white">
      <div className="flex h-20 items-center justify-between border-b border-white/10 px-5">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-white/10 text-[var(--lagoon)]">
            <Mail size={20} strokeWidth={2.25} />
          </span>
          <div>
            <p className="text-[0.62rem] font-extrabold tracking-[0.17em] text-white/60 uppercase">
              Cloudflare
            </p>
            <p className="display-title text-lg leading-tight font-bold">
              Inbox
            </p>
          </div>
        </div>
        {onClose ? (
          <Button
            variant="ghost"
            size="icon-lg"
            type="button"
            aria-label="Close mailbox navigation"
            onClick={onClose}
            className="size-10 rounded-xl text-white/65 hover:bg-white/10 hover:text-white xl:hidden"
          >
            <PanelLeftClose size={20} />
          </Button>
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
            <span className="block truncate text-[0.68rem] text-white/60">
              {mailboxAddress}
            </span>
          </span>
        </div>
      </div>

      <nav
        aria-label="Mailbox"
        className="min-h-0 flex-1 overflow-y-auto px-4 pt-7 pb-5"
      >
        <section aria-label="Folders">
          <h2 className="px-3 text-[0.62rem] font-extrabold tracking-[0.16em] text-white/60 uppercase">
            Folders
          </h2>
          <div className="mt-2 space-y-1">
            {folders.map((folder) => {
              const selected = folder.id === selectedFolderId;
              const FolderIcon = folderIconByKind[folder.kind];
              const showsTotal =
                folder.kind === "drafts" || folder.kind === "scheduled";
              const showsUnread =
                folder.kind === "inbox" || folder.kind === "spam";
              const count = showsTotal
                ? folder.messageCount
                : showsUnread
                  ? folder.unreadCount
                  : 0;
              const countLabel = showsTotal
                ? `${count} ${folder.kind}`
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
                  onClick={(event) => {
                    if (
                      event.button === 0 &&
                      !event.altKey &&
                      !event.ctrlKey &&
                      !event.metaKey &&
                      !event.shiftKey
                    ) {
                      event.preventDefault();
                      onNavigate({ folder: folder.id });
                      onClose?.();
                    }
                  }}
                  onFocus={() => onPrefetch({ folder: folder.id })}
                  onMouseEnter={() => onPrefetch({ folder: folder.id })}
                  className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm no-underline ${
                    selected
                      ? "bg-[var(--nav-selection)] font-extrabold text-[var(--sea-ink)] shadow-[0_8px_22px_rgba(0,0,0,0.13)] hover:text-[var(--sea-ink)]"
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
          <h2 className="px-3 text-[0.62rem] font-extrabold tracking-[0.16em] text-white/60 uppercase">
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
                    onClick={(event) => {
                      if (
                        event.button === 0 &&
                        !event.altKey &&
                        !event.ctrlKey &&
                        !event.metaKey &&
                        !event.shiftKey
                      ) {
                        event.preventDefault();
                        onNavigate({ label: label.id });
                        onClose?.();
                      }
                    }}
                    onFocus={() => onPrefetch({ label: label.id })}
                    onMouseEnter={() => onPrefetch({ label: label.id })}
                    className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm no-underline ${
                      selected
                        ? "bg-[var(--nav-selection)] font-extrabold text-[var(--sea-ink)] shadow-[0_8px_22px_rgba(0,0,0,0.13)] hover:text-[var(--sea-ink)]"
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
            <p className="px-3 pt-3 text-xs leading-5 text-white/60">
              No labels yet
            </p>
          )}
        </section>

        <a
          href="/mail/settings"
          aria-current={settingsSelected ? "page" : undefined}
          onClick={(event) => {
            if (
              event.button === 0 &&
              !event.altKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.shiftKey
            ) {
              event.preventDefault();
              onSettingsNavigate();
              onClose?.();
            }
          }}
          className={`mt-7 flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm no-underline ${
            settingsSelected
              ? "bg-[var(--nav-selection)] font-extrabold text-[var(--sea-ink)] shadow-[0_8px_22px_rgba(0,0,0,0.13)] hover:text-[var(--sea-ink)]"
              : "font-bold text-white/66 hover:bg-white/8 hover:text-white"
          }`}
        >
          <SettingsIcon
            size={17}
            className={settingsSelected ? "text-[var(--palm)]" : ""}
          />
          <span>Settings</span>
        </a>
      </nav>

      <div className="border-t border-white/10 p-4">
        <div className="mb-3 flex items-center gap-2 px-2 text-[0.68rem] font-bold text-white/60">
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
          <Button
            variant="ghost"
            size="icon-lg"
            type="button"
            aria-label="Sign out"
            disabled={isSigningOut}
            onClick={onSignOut}
            className="size-9 shrink-0 rounded-xl text-white/52 hover:bg-white/10 hover:text-white disabled:opacity-45"
          >
            {isSigningOut ? (
              <LoaderCircle className="animate-spin" size={17} />
            ) : (
              <LogOut size={17} />
            )}
          </Button>
        </div>
        {signOutError === undefined ? null : (
          <Alert className="mt-2 block w-auto rounded-none border-0 bg-transparent px-2 py-0 text-[0.68rem] font-bold text-red-200">
            {signOutError}
          </Alert>
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
  mailboxAddress,
  mailboxName,
  onNavigate,
  onPrefetch,
  onSignOut,
  onSettingsNavigate,
  outboundDeliveryId,
  principalLabel,
  selectedFolderId,
  selectedLabelId,
  signOutError,
  settingsSelected,
  viewTitle,
}: MailboxShellProps) {
  const [navigationOpen, setNavigationOpen] = useState(false);

  return (
    <Sheet open={navigationOpen} onOpenChange={setNavigationOpen}>
      <main className="fixed inset-0 overflow-hidden bg-[var(--surface-strong)]">
        <div className="flex h-full min-h-0 overflow-hidden bg-[var(--surface-strong)]">
          <aside className="hidden w-72 shrink-0 xl:block">
            <MailboxNavigation
              folders={folders}
              isSigningOut={isSigningOut}
              labels={labels}
              mailboxAddress={mailboxAddress}
              mailboxName={mailboxName}
              onNavigate={onNavigate}
              onPrefetch={onPrefetch}
              onSignOut={onSignOut}
              onSettingsNavigate={onSettingsNavigate}
              outboundDeliveryId={outboundDeliveryId}
              principalLabel={principalLabel}
              selectedFolderId={selectedFolderId}
              selectedLabelId={selectedLabelId}
              signOutError={signOutError}
              settingsSelected={settingsSelected}
            />
          </aside>

          <SheetContent
            side="left"
            showCloseButton={false}
            className="h-full w-[min(19rem,88vw)] max-w-none gap-0 border-0 p-0 shadow-2xl xl:hidden"
          >
            <SheetTitle className="sr-only">Mailbox navigation</SheetTitle>
            <MailboxNavigation
              folders={folders}
              isSigningOut={isSigningOut}
              labels={labels}
              mailboxAddress={mailboxAddress}
              mailboxName={mailboxName}
              onClose={() => setNavigationOpen(false)}
              onNavigate={onNavigate}
              onPrefetch={onPrefetch}
              onSignOut={onSignOut}
              onSettingsNavigate={onSettingsNavigate}
              outboundDeliveryId={outboundDeliveryId}
              principalLabel={principalLabel}
              selectedFolderId={selectedFolderId}
              selectedLabelId={selectedLabelId}
              signOutError={signOutError}
              settingsSelected={settingsSelected}
            />
          </SheetContent>

          <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <header className="flex h-20 min-w-0 shrink-0 items-center justify-between gap-1 border-b border-[var(--line)] bg-[var(--header-bg)] px-3 min-[360px]:gap-2 min-[360px]:px-4 sm:px-6 lg:px-8">
              <div className="flex min-w-0 flex-1 items-center gap-2 min-[360px]:gap-3">
                <SheetTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon-lg"
                      aria-label="Open mailbox navigation"
                      className="size-10 shrink-0 rounded-xl border-[var(--line)] bg-[var(--control-bg)] text-[var(--sea-ink-soft)] hover:bg-[var(--surface-strong)] xl:hidden"
                    />
                  }
                >
                  <Menu size={20} />
                </SheetTrigger>
                <div className="min-w-0">
                  <p className="text-[0.62rem] font-extrabold tracking-[0.16em] text-[var(--palm)] uppercase">
                    {mailboxName}
                  </p>
                  <h1 className="display-title truncate text-xl font-bold tracking-tight min-[360px]:text-2xl sm:text-[1.7rem]">
                    {viewTitle}
                  </h1>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1 min-[360px]:gap-2">
                {headerAction}
                <ThemeToggle />
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
          </section>
        </div>
      </main>
    </Sheet>
  );
}
