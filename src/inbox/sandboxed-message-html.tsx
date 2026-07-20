import { useRef, useState } from "react";

const ignoreAccessFailure = (_status: 401 | 403) => null;

export function SandboxedMessageHtml({
  onAccessFailure = ignoreAccessFailure,
  src,
  title,
}: {
  readonly onAccessFailure?: (status: 401 | 403) => void;
  readonly src: string;
  readonly title: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const iframe = useRef<HTMLIFrameElement>(null);
  const retrySrc =
    attempt === 0
      ? src
      : `${src}${src.includes("?") ? "&" : "?"}previewRetry=${attempt}`;

  return (
    <div className="relative min-h-96">
      {failed ? (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--foam)] px-5 text-center"
        >
          <p className="text-sm font-bold text-[var(--sea-ink)]">
            Secure HTML preview could not be loaded.
          </p>
          <button
            type="button"
            onClick={() => {
              setAttempt((current) => current + 1);
              setFailed(false);
              setLoaded(false);
            }}
            className="mt-3 rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-xs font-extrabold"
          >
            Try again
          </button>
        </div>
      ) : loaded ? null : (
        <output className="absolute inset-0 flex items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--foam)] text-sm font-bold text-[var(--sea-ink-soft)]">
          Loading secure HTML preview...
        </output>
      )}
      <iframe
        ref={iframe}
        aria-hidden={!loaded || failed}
        sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
        referrerPolicy="no-referrer"
        loading="lazy"
        onLoad={() => {
          let previewStatus: string | undefined;
          let accessFailure: string | undefined;
          let previewFailed = false;
          try {
            const { current } = iframe;
            const previewDocument =
              current === null ? null : current.contentDocument;
            const previewRoot =
              previewDocument === null ? null : previewDocument.documentElement;
            previewFailed = previewRoot === null;
            previewStatus =
              previewRoot === null
                ? undefined
                : previewRoot.dataset["previewStatus"];
            accessFailure =
              previewRoot === null
                ? undefined
                : previewRoot.dataset["previewAccessFailure"];
            previewFailed ||= previewStatus !== undefined;
          } catch {
            previewFailed = true;
          }
          if (accessFailure === "401" || accessFailure === "403") {
            onAccessFailure(accessFailure === "401" ? 401 : 403);
          }
          setFailed(previewFailed);
          setLoaded(!previewFailed);
        }}
        src={retrySrc}
        title={title}
        inert={!loaded || failed}
        className={`h-96 w-full rounded-xl border border-[var(--line)] bg-white ${loaded && !failed ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}
