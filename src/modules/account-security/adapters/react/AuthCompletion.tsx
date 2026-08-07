import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  CheckCircle2,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { startTransition, useEffect, useState } from "react";

import { parseCompletionHash } from "#/modules/account-security/domain/CompletionUrl";
import type { CompletionCredentials } from "#/modules/account-security/domain/CompletionUrl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface CompletionShellProps {
  readonly action: string;
  readonly children?: ReactNode;
  readonly description: string;
  readonly error?: string;
  readonly isPending: boolean;
  readonly isReady: boolean;
  readonly onSubmit: () => void;
  readonly success?: string;
  readonly title: string;
}

export function CompletionShell({
  action,
  children,
  description,
  error,
  isPending,
  isReady,
  onSubmit,
  success,
  title,
}: CompletionShellProps) {
  return (
    <main className="min-h-screen px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-lg">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-2 text-sm font-semibold no-underline"
        >
          <ArrowLeft size={16} /> Back to sign in
        </Link>
        <section className="island-shell rounded-[2rem] p-7 sm:p-10">
          <div className="mb-7 flex size-12 items-center justify-center rounded-2xl bg-[var(--sea-ink)] text-[var(--bg-base)] shadow-lg">
            <ShieldCheck size={24} />
          </div>
          <p className="island-kicker">Secure handoff</p>
          <h1 className="display-title mt-3 text-4xl font-bold tracking-tight">
            {title}
          </h1>
          <p className="mt-4 leading-7 text-[var(--sea-ink-soft)]">
            {description}
          </p>

          <div className="mt-8 space-y-5">
            {children}
            {error ? (
              <Alert className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger-fg)]">
                <AlertDescription className="text-inherit">
                  {error}
                </AlertDescription>
              </Alert>
            ) : null}
            {success ? (
              <Alert className="flex items-center gap-2 rounded-xl border border-[var(--success-border)] bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success-fg)]">
                <CheckCircle2 size={17} />
                <AlertDescription className="text-inherit">
                  {success}
                </AlertDescription>
              </Alert>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              disabled={!isReady || isPending || Boolean(success)}
              onClick={onSubmit}
              className="flex h-auto w-full items-center justify-center gap-2 rounded-xl bg-[var(--sea-ink)] px-5 py-3.5 text-base font-bold text-[var(--bg-base)] shadow-lg transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? (
                <LoaderCircle className="animate-spin" size={18} />
              ) : null}
              {action}
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}

export const useCompletionCredentials = () => {
  const [credentials, setCredentials] = useState<CompletionCredentials>(() => ({
    challengeId: "",
  }));

  useEffect(() => {
    const parsed = parseCompletionHash(window.location.hash);
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`
    );
    startTransition(() => setCredentials(parsed));
  }, []);

  return credentials;
};
