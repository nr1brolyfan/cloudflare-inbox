import { Popover } from "@base-ui/react/popover";
import {
  LoaderCircle,
  MailPlus,
  Trash2,
  UserRoundCheck,
  X,
} from "lucide-react";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import type { ContactDetail } from "#/modules/mailbox/domain/MailboxContact";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const contactDate = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

export function ContactCard({
  address,
  children,
  initialSaved,
  loadDetail,
  onRemove,
  onSave,
}: {
  readonly address: {
    readonly address: string;
    readonly displayName?: string;
  };
  readonly children: ReactNode;
  readonly initialSaved: boolean;
  readonly loadDetail: () => Promise<ContactDetail>;
  readonly onRemove: (expectedVersion?: number) => Promise<void>;
  readonly onSave: (
    displayName: string | undefined,
    expectedVersion?: number
  ) => Promise<ContactDetail>;
}) {
  const [detail, setDetail] = useState<ContactDetail>();
  const [attempted, setAttempted] = useState(false);
  const [displayName, setDisplayName] = useState(address.displayName ?? "");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const nameInputId = useId();
  const saved = detail?.saved ?? initialSaved;
  const openCard = async () => {
    setAttempted(true);
    setLoading(true);
    setError(false);
    try {
      const loaded = await loadDetail();
      setDetail(loaded);
      setDisplayName(loaded.displayName ?? "");
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };
  const saveCurrent = async () => {
    if (detail === undefined) {
      return;
    }
    setSaving(true);
    setError(false);
    try {
      setDetail(await onSave(displayName.trim() || undefined, detail.version));
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };
  const removeCurrent = async () => {
    if (detail === undefined) {
      return;
    }
    setSaving(true);
    setError(false);
    try {
      await onRemove(detail.version);
      setDetail({
        ...detail,
        saved: false,
        savedAt: undefined,
        version: undefined,
      });
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  const firstInteractionAt = detail?.firstInteractionAt;
  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen && detail === undefined && !loading && !attempted) {
          void openCard();
        }
        if (!nextOpen) {
          setDetail(undefined);
          setAttempted(false);
        }
      }}
    >
      <Popover.Trigger className="font-inherit inline-flex max-w-full items-center gap-1 rounded-sm text-left text-inherit underline decoration-transparent underline-offset-2 outline-none hover:decoration-[var(--lagoon-deep)] focus-visible:ring-2 focus-visible:ring-[var(--lagoon-deep)]">
        <span className="truncate">{children}</span>
        {saved ? (
          <UserRoundCheck
            aria-label="Saved contact"
            className="shrink-0 text-[var(--palm)]"
            size={13}
          />
        ) : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="z-50" sideOffset={8}>
          <Popover.Popup className="w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-4 text-[var(--sea-ink)] shadow-2xl outline-none">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--sand)] text-sm font-extrabold text-[var(--palm)]">
                {(detail?.displayName ?? address.displayName ?? address.address)
                  .slice(0, 2)
                  .toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <Popover.Title className="truncate text-sm font-extrabold">
                  {detail?.displayName ??
                    address.displayName ??
                    address.address}
                </Popover.Title>
                <Popover.Description className="mt-0.5 truncate text-xs text-[var(--sea-ink-soft)]">
                  {address.address}
                </Popover.Description>
                <p className="mt-1 text-[0.65rem] font-bold text-[var(--palm)]">
                  {saved ? "Saved contact" : "Suggested contact"}
                </p>
              </div>
              <Popover.Close
                aria-label="Close contact card"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[var(--sea-ink-soft)] hover:bg-[var(--control-bg)]"
              >
                <X size={15} />
              </Popover.Close>
            </div>

            {loading ? (
              <output className="flex h-24 items-center justify-center text-[var(--sea-ink-soft)]">
                <LoaderCircle
                  aria-label="Loading contact"
                  className="animate-spin"
                />
              </output>
            ) : null}
            {error ? (
              <Alert className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
                Could not load or update this contact.
              </Alert>
            ) : null}
            {detail === undefined ? null : (
              <>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-[var(--control-bg)] p-3">
                    <p className="text-[0.62rem] font-bold text-[var(--sea-ink-soft)] uppercase">
                      Messages
                    </p>
                    <p className="mt-1 text-sm font-extrabold">
                      {detail.sentCount + detail.receivedCount}
                    </p>
                    <p className="text-[0.65rem] text-[var(--sea-ink-soft)]">
                      {detail.sentCount} sent · {detail.receivedCount} received
                    </p>
                  </div>
                  <div className="rounded-xl bg-[var(--control-bg)] p-3">
                    <p className="text-[0.62rem] font-bold text-[var(--sea-ink-soft)] uppercase">
                      In touch since
                    </p>
                    <p className="mt-1 text-xs font-extrabold">
                      {firstInteractionAt === undefined
                        ? "No messages yet"
                        : contactDate.format(new Date(firstInteractionAt))}
                    </p>
                  </div>
                </div>
                <label
                  className="mt-4 block text-xs font-bold"
                  htmlFor={nameInputId}
                >
                  Contact name
                </label>
                <Input
                  className="mt-1.5 h-10 rounded-xl border-[var(--line)] bg-[var(--control-bg)]"
                  disabled={saving}
                  id={nameInputId}
                  maxLength={200}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Optional name"
                  value={displayName}
                />
                <div className="mt-4 flex items-center gap-2">
                  <Button
                    className="h-10 flex-1 rounded-xl bg-[var(--sea-ink)] text-[var(--bg-base)] hover:bg-[var(--palm)]"
                    disabled={saving}
                    onClick={() => void saveCurrent()}
                    type="button"
                  >
                    {saving ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <MailPlus />
                    )}
                    {saved ? "Save changes" : "Add to contacts"}
                  </Button>
                  {saved ? (
                    <Button
                      aria-label="Remove from contacts"
                      className="size-10 rounded-xl text-red-700 hover:bg-red-50"
                      disabled={saving}
                      onClick={() => void removeCurrent()}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 size={16} />
                    </Button>
                  ) : null}
                </div>
              </>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
