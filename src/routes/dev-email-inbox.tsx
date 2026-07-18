import { useMutation } from "@tanstack/react-query";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import {
  Clock3,
  ExternalLink,
  Inbox,
  MailOpen,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { startTransition, useState } from "react";

import type { DevEmailRecord } from "../http/dev-emails";
import { clearDevEmails, listDevEmails } from "../server/dev-email-functions";

const kindLabel = (kind: DevEmailRecord["kind"]) =>
  kind.split(/(?=[A-Z])/u).join(" ");

const senderLabel = (sender: DevEmailRecord["sender"]) => {
  if (sender === undefined) {
    return "Effect Auth";
  }
  if (typeof sender === "string") {
    return sender;
  }
  return sender.name ? `${sender.name} <${sender.email}>` : sender.email;
};

const linksFromText = (text: string | undefined) =>
  text
    ?.match(/https?:\/\/[^\s<>]+/gu)
    ?.map((url) => url.replace(/[),.;]+$/u, "")) ?? [];

const otpFromText = (text: string | undefined) =>
  text?.match(/\b\d{6}\b/u)?.[0];

const sandboxedHtml = (html: string) => `
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; font-src data:">
  <base target="_blank">
  ${html}
`;

export const Route = createFileRoute("/dev-email-inbox")({
  loader: async () => {
    const inbox = await listDevEmails();
    if (!inbox.enabled) {
      throw notFound();
    }
    return inbox.messages;
  },
  component: DevEmailInbox,
});

function DevEmailInbox() {
  const messages = Route.useLoaderData();
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(messages[0]?.id);
  const [preview, setPreview] = useState<"html" | "text">("text");
  const selected =
    messages.find((message) => message.id === selectedId) ?? messages[0];
  const clear = useMutation({
    mutationFn: () => clearDevEmails(),
    onSuccess: async () => {
      await router.invalidate();
    },
  });
  const links = linksFromText(selected?.text);
  const otp = otpFromText(selected?.text);

  return (
    <main className="min-h-screen px-3 py-3 sm:px-6 sm:py-6">
      <div className="mx-auto flex min-h-[calc(100vh-1.5rem)] max-w-7xl flex-col overflow-hidden rounded-[2rem] border border-[var(--line)] bg-white/68 shadow-[0_28px_80px_rgba(23,58,64,0.14)] backdrop-blur-md sm:min-h-[calc(100vh-3rem)]">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] bg-[var(--sea-ink)] px-6 py-5 text-white sm:px-8">
          <div className="flex items-center gap-4">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-white/10">
              <MailOpen size={21} />
            </span>
            <div>
              <p className="text-xs font-extrabold tracking-[0.18em] text-white/55 uppercase">
                Local development
              </p>
              <h1 className="display-title text-2xl font-bold">
                Auth email inbox
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => startTransition(() => void router.invalidate())}
              className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/8 px-3.5 py-2 text-sm font-bold hover:bg-white/14"
            >
              <RefreshCw size={16} /> Refresh
            </button>
            <button
              type="button"
              disabled={messages.length === 0 || clear.isPending}
              onClick={() => clear.mutate()}
              className="flex items-center gap-2 rounded-xl border border-rose-200/20 bg-rose-300/10 px-3.5 py-2 text-sm font-bold text-rose-50 hover:bg-rose-300/20 disabled:opacity-40"
            >
              <Trash2 size={16} /> Clear
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[22rem_1fr]">
          <aside className="border-b border-[var(--line)] bg-[var(--sand)]/45 lg:border-r lg:border-b-0">
            <div className="flex items-center justify-between px-5 py-4">
              <span className="text-sm font-extrabold">Messages</span>
              <span className="rounded-full bg-white/75 px-2.5 py-1 text-xs font-bold text-[var(--sea-ink-soft)]">
                {messages.length}
              </span>
            </div>
            <div className="max-h-72 overflow-y-auto px-3 pb-3 lg:max-h-[calc(100vh-9.5rem)]">
              {messages.map((message) => (
                <button
                  key={message.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(message.id);
                    setPreview("text");
                  }}
                  className={`mb-2 w-full rounded-2xl border p-4 text-left transition ${selected?.id === message.id ? "border-[var(--lagoon)] bg-white shadow-sm" : "border-transparent bg-white/45 hover:border-[var(--line)] hover:bg-white/75"}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-xs font-extrabold tracking-wide text-[var(--palm)] uppercase">
                      {kindLabel(message.kind)}
                    </span>
                    <span className="shrink-0 text-[0.68rem] text-[var(--sea-ink-soft)]">
                      {new Date(message.createdAt).toISOString().slice(11, 19)}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-sm font-extrabold">
                    {message.subject}
                  </p>
                  <p className="mt-1 truncate text-xs text-[var(--sea-ink-soft)]">
                    To {message.recipient}
                  </p>
                </button>
              ))}
              {messages.length === 0 ? (
                <div className="px-5 py-12 text-center text-[var(--sea-ink-soft)]">
                  <Inbox className="mx-auto mb-3 opacity-40" />
                  <p className="text-sm font-bold">No auth emails yet</p>
                  <p className="mt-1 text-xs">
                    Start an OTP or magic-link flow.
                  </p>
                </div>
              ) : null}
            </div>
          </aside>

          <section className="min-w-0 bg-white/55 p-5 sm:p-8">
            {selected ? (
              <div className="mx-auto max-w-4xl">
                <div className="border-b border-[var(--line)] pb-6">
                  <p className="island-kicker">{kindLabel(selected.kind)}</p>
                  <h2 className="display-title mt-2 text-3xl font-bold tracking-tight">
                    {selected.subject}
                  </h2>
                  <div className="mt-4 grid gap-2 text-sm text-[var(--sea-ink-soft)] sm:grid-cols-2">
                    <p>
                      <span className="font-bold text-[var(--sea-ink)]">
                        To:
                      </span>{" "}
                      {selected.recipient}
                    </p>
                    <p>
                      <span className="font-bold text-[var(--sea-ink)]">
                        From:
                      </span>{" "}
                      {senderLabel(selected.sender)}
                    </p>
                    <p className="flex items-center gap-1.5 sm:col-span-2">
                      <Clock3 size={14} /> Expires{" "}
                      {new Date(selected.expiresAt).toISOString()}
                    </p>
                  </div>
                </div>

                {otp || links.length > 0 ? (
                  <div className="my-6 flex flex-wrap gap-3">
                    {otp ? (
                      <div className="rounded-2xl border border-[var(--chip-line)] bg-[var(--sand)]/65 px-5 py-3">
                        <p className="text-[0.65rem] font-extrabold tracking-[0.16em] text-[var(--palm)] uppercase">
                          One-time code
                        </p>
                        <p className="mt-1 font-mono text-2xl font-bold tracking-[0.25em]">
                          {otp}
                        </p>
                      </div>
                    ) : null}
                    {links.map((link) => (
                      <a
                        key={link}
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        className="flex max-w-full items-center gap-2 rounded-2xl bg-[var(--sea-ink)] px-5 py-3 text-sm font-bold text-white no-underline hover:text-white"
                      >
                        <ExternalLink size={16} />
                        <span className="truncate">Open action link</span>
                      </a>
                    ))}
                  </div>
                ) : null}

                {selected.html ? (
                  <div className="mb-4 flex gap-1 rounded-xl bg-[var(--sand)]/65 p-1">
                    {(["text", "html"] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setPreview(value)}
                        className={`rounded-lg px-4 py-2 text-xs font-extrabold uppercase ${preview === value ? "bg-white shadow-sm" : "text-[var(--sea-ink-soft)]"}`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                ) : null}

                {preview === "html" && selected.html ? (
                  <iframe
                    title={selected.subject}
                    sandbox=""
                    referrerPolicy="no-referrer"
                    srcDoc={sandboxedHtml(selected.html)}
                    className="h-[34rem] w-full rounded-2xl border border-[var(--line)] bg-white"
                  />
                ) : (
                  <pre className="min-h-72 overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--foam)] p-5 font-sans text-sm leading-7 whitespace-pre-wrap">
                    {selected.text ?? "This message has no text body."}
                  </pre>
                )}
              </div>
            ) : (
              <div className="flex min-h-80 items-center justify-center text-center text-[var(--sea-ink-soft)]">
                <div>
                  <MailOpen className="mx-auto mb-4 opacity-35" size={38} />
                  <p className="font-bold">
                    Select an auth email to inspect it.
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
