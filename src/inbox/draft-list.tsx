import type * as Schema from "effect/Schema";
import { FilePenLine, LoaderCircle, Paperclip } from "lucide-react";

import type { MailboxDraftListResult } from "../mailboxes/draft-reading";
import { mailboxDraftHref } from "./mailbox-view-links";

type DraftListData = Schema.Codec.Encoded<typeof MailboxDraftListResult>;

const draftDate = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const addressName = (address: {
  readonly address: string;
  readonly displayName?: string;
}) => address.displayName ?? address.address;

const recipientLabel = (draft: DraftListData["items"][number]) =>
  draft.recipients.length === 0
    ? "No recipients"
    : `To ${draft.recipients.map(addressName).join(", ")}`;

export function DraftList({
  data,
  deliveryId,
  folderId,
  isLoadingMore,
  loadMoreFailed,
  onLoadMore,
  onOpenDraft,
}: {
  readonly data: DraftListData;
  readonly deliveryId?: string;
  readonly folderId: string;
  readonly isLoadingMore: boolean;
  readonly loadMoreFailed: boolean;
  readonly onLoadMore: () => void;
  readonly onOpenDraft: (draftId: string) => void;
}) {
  return (
    <section
      aria-label="Drafts"
      className="flex h-full min-h-0 flex-col bg-white/42"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--line)] px-5 py-4 sm:px-7">
        <div>
          <p className="text-xs font-extrabold tracking-[0.12em] text-[var(--sea-ink-soft)] uppercase">
            Saved drafts
          </p>
          <p className="mt-1 text-xs text-[var(--sea-ink-soft)]">
            Open a draft to continue writing or send it.
          </p>
        </div>
        <span className="rounded-full bg-[var(--sand)] px-2.5 py-1 text-[0.65rem] font-extrabold text-[var(--palm)]">
          {data.items.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
        {data.items.length === 0 ? (
          <div className="flex min-h-72 items-center justify-center px-6 text-center text-[var(--sea-ink-soft)]">
            <div>
              <FilePenLine className="mx-auto opacity-30" size={36} />
              <p className="mt-4 text-sm font-extrabold">No saved drafts</p>
              <p className="mt-1 text-xs leading-5">
                Choose Compose and save your message to keep it here.
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-4xl space-y-2">
            {data.items.map((draft) => {
              const recipients = recipientLabel(draft);
              return (
                <article
                  key={draft.id}
                  className="overflow-hidden rounded-2xl border border-transparent text-[var(--sea-ink)] hover:border-[var(--line)] hover:bg-white/72"
                >
                  <a
                    href={mailboxDraftHref(folderId, draft.id, deliveryId)}
                    aria-label={`${recipients}: ${draft.subject || "No subject"}`}
                    onClick={(event) => {
                      if (
                        event.button === 0 &&
                        !event.altKey &&
                        !event.ctrlKey &&
                        !event.metaKey &&
                        !event.shiftKey
                      ) {
                        event.preventDefault();
                        onOpenDraft(draft.id);
                      }
                    }}
                    className="block px-4 py-4 text-inherit no-underline hover:text-inherit sm:px-5"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--sand)] text-[var(--palm)]">
                        <FilePenLine size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-extrabold">
                          {recipients}
                        </span>
                        <span className="mt-1 flex items-center gap-2">
                          <span className="truncate text-sm font-bold">
                            {draft.subject || "(No subject)"}
                          </span>
                          {draft.hasAttachments ? (
                            <Paperclip
                              aria-label="Has attachments"
                              className="shrink-0 text-[var(--sea-ink-soft)]"
                              size={14}
                            />
                          ) : null}
                        </span>
                        <span className="mt-1 block truncate text-xs leading-5 text-[var(--sea-ink-soft)]">
                          {draft.snippet || "No text preview"}
                        </span>
                      </span>
                      <span className="shrink-0 self-start text-[0.65rem] font-bold text-[var(--sea-ink-soft)]">
                        {draftDate.format(new Date(draft.updatedAt))}
                      </span>
                    </div>
                  </a>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {data.nextCursor === undefined ? null : (
        <div className="border-t border-[var(--line)] p-3 text-center">
          {loadMoreFailed ? (
            <p className="mb-2 text-[0.68rem] font-bold text-red-700">
              More drafts could not be loaded.
            </p>
          ) : null}
          <button
            type="button"
            disabled={isLoadingMore}
            onClick={onLoadMore}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/72 px-4 py-2 text-[0.7rem] font-extrabold disabled:opacity-55"
          >
            {isLoadingMore ? (
              <LoaderCircle className="animate-spin" size={14} />
            ) : null}
            {loadMoreFailed ? "Try again" : "Load more"}
          </button>
        </div>
      )}
    </section>
  );
}
