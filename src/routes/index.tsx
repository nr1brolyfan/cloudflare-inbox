import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";

import { authClient, authErrorMessage, emailIdentity } from "../auth/client";
import { bootstrapMailboxOwner } from "../server/mailbox-functions";

export const Route = createFileRoute("/")({ component: Home });

type AuthMode = "magic" | "otp" | "password";

function Home() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<AuthMode>("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpChallengeId, setOtpChallengeId] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const session = useQuery({
    queryKey: ["auth", "session"],
    queryFn: ({ signal }) => authClient.session.currentOrUndefined({ signal }),
    retry: false,
  });

  const completeAuthentication = async (result: { type: string }) => {
    if (result.type !== "authenticated") {
      setNotice("This account requires an additional authentication step.");
      return;
    }

    setNotice(undefined);
    await queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
  };

  const magicLink = useMutation({
    mutationFn: () => authClient.magicLink.start(emailIdentity(email)),
    retry: false,
    onSuccess: () =>
      setNotice("Check your email. The sign-in link is valid for 15 minutes."),
  });

  const otpStart = useMutation({
    mutationFn: () => authClient.emailOtp.start(emailIdentity(email)),
    retry: false,
    onSuccess: (result) => {
      setOtpChallengeId(result.challengeId);
      setNotice("We sent a six-digit code to your email address.");
    },
  });

  const otpVerify = useMutation({
    mutationFn: () =>
      authClient.emailOtp.verify({
        challengeId: otpChallengeId ?? "",
        secret: otpCode,
      }),
    retry: false,
    onSuccess: completeAuthentication,
  });

  const passwordAuth = useMutation({
    mutationFn: () =>
      authClient.password.signIn({ ...emailIdentity(email), password }),
    retry: false,
    onSuccess: completeAuthentication,
  });

  const passwordReset = useMutation({
    mutationFn: () => authClient.password.reset.start(emailIdentity(email)),
    retry: false,
    onSuccess: () =>
      setNotice(
        "If that address has a password account, a reset link is on its way."
      ),
  });

  const logout = useMutation({
    mutationFn: () => authClient.session.logout(),
    retry: false,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["auth", "session"] }),
  });
  const mailboxBootstrap = useMutation({
    mutationFn: () => bootstrapMailboxOwner({ data: { displayName: "Inbox" } }),
    retry: false,
  });

  const activeMutation =
    mode === "magic"
      ? magicLink
      : mode === "otp"
        ? otpChallengeId
          ? otpVerify
          : otpStart
        : passwordAuth;
  const error = activeMutation.error ?? passwordReset.error ?? session.error;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setNotice(undefined);
    activeMutation.mutate();
  };

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-6xl overflow-hidden rounded-[2.25rem] border border-[var(--line)] bg-white/55 shadow-[0_28px_80px_rgba(23,58,64,0.14)] backdrop-blur-md lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative flex min-h-[28rem] flex-col justify-between overflow-hidden bg-[var(--sea-ink)] p-8 text-white sm:p-12 lg:p-16">
          <div className="absolute -top-24 -right-24 size-80 rounded-full border border-white/10 bg-[var(--lagoon)]/20 blur-sm" />
          <div className="absolute -bottom-28 -left-20 size-72 rounded-full border border-white/10 bg-emerald-300/10" />
          <div className="relative">
            <div className="flex items-center gap-3 text-sm font-extrabold tracking-[0.18em] uppercase">
              <span className="flex size-10 items-center justify-center rounded-xl bg-white/10">
                <Mail size={20} />
              </span>
              Cloudflare Inbox
            </div>
            <h1 className="display-title mt-16 max-w-xl text-5xl leading-[0.98] font-bold tracking-tight sm:text-6xl">
              Your mail,
              <br />
              quietly in order.
            </h1>
            <p className="mt-7 max-w-md text-base leading-7 text-white/68">
              A focused inbox built at the edge. Search, organize, and reply
              without surrendering control of your messages.
            </p>
          </div>
          <div className="relative grid gap-3 text-sm text-white/78 sm:grid-cols-2">
            <p className="flex items-center gap-2">
              <ShieldCheck size={17} /> Private worker boundary
            </p>
            <p className="flex items-center gap-2">
              <LockKeyhole size={17} /> HttpOnly sessions
            </p>
          </div>
        </section>

        <section className="flex items-center p-7 sm:p-12 lg:p-14">
          <div className="mx-auto w-full max-w-md">
            {session.isLoading ? (
              <div className="flex items-center justify-center py-24 text-[var(--sea-ink-soft)]">
                <LoaderCircle className="animate-spin" />
              </div>
            ) : session.data ? (
              <SignedIn
                bootstrapError={mailboxBootstrap.error}
                bootstrapResult={mailboxBootstrap.data}
                userId={session.data.userId}
                isBootstrapPending={mailboxBootstrap.isPending}
                isPending={logout.isPending}
                onBootstrap={() => mailboxBootstrap.mutate()}
                onLogout={() => logout.mutate()}
              />
            ) : (
              <>
                <p className="island-kicker">Welcome back</p>
                <h2 className="display-title mt-3 text-4xl font-bold tracking-tight">
                  Sign in to your inbox
                </h2>
                <p className="mt-3 text-sm leading-6 text-[var(--sea-ink-soft)]">
                  Use a one-time link, email code, or your password.
                </p>

                <div className="mt-7 grid grid-cols-3 rounded-xl bg-[var(--sand)]/75 p-1">
                  {(["magic", "otp", "password"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setMode(value);
                        setNotice(undefined);
                      }}
                      className={`rounded-lg px-2 py-2.5 text-xs font-bold capitalize ${mode === value ? "bg-white text-[var(--sea-ink)] shadow-sm" : "text-[var(--sea-ink-soft)]"}`}
                    >
                      {value === "magic" ? "Magic link" : value}
                    </button>
                  ))}
                </div>

                <form className="mt-7 space-y-5" onSubmit={submit}>
                  <label className="block space-y-2 text-sm font-bold">
                    <span>Email address</span>
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="w-full rounded-xl border border-[var(--line)] bg-white/80 px-4 py-3.5 outline-none focus:border-[var(--lagoon-deep)]"
                    />
                  </label>

                  {mode === "otp" && otpChallengeId ? (
                    <label className="block space-y-2 text-sm font-bold">
                      <span>Six-digit code</span>
                      <input
                        type="text"
                        required
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        value={otpCode}
                        onChange={(event) => setOtpCode(event.target.value)}
                        className="w-full rounded-xl border border-[var(--line)] bg-white/80 px-4 py-3.5 tracking-[0.35em] outline-none focus:border-[var(--lagoon-deep)]"
                      />
                    </label>
                  ) : null}

                  {mode === "password" ? (
                    <label className="block space-y-2 text-sm font-bold">
                      <span>Password</span>
                      <input
                        type="password"
                        required
                        autoComplete="current-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="w-full rounded-xl border border-[var(--line)] bg-white/80 px-4 py-3.5 outline-none focus:border-[var(--lagoon-deep)]"
                      />
                    </label>
                  ) : null}

                  {notice ? <Notice>{notice}</Notice> : null}
                  {error ? (
                    <ErrorNotice>{authErrorMessage(error)}</ErrorNotice>
                  ) : null}

                  <button
                    type="submit"
                    disabled={activeMutation.isPending}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--sea-ink)] px-5 py-3.5 font-bold text-white shadow-lg hover:-translate-y-0.5 disabled:opacity-50"
                  >
                    {activeMutation.isPending ? (
                      <LoaderCircle className="animate-spin" size={18} />
                    ) : mode === "otp" ? (
                      <KeyRound size={18} />
                    ) : (
                      <ArrowRight size={18} />
                    )}
                    {mode === "magic"
                      ? "Email me a sign-in link"
                      : mode === "otp"
                        ? otpChallengeId
                          ? "Verify code"
                          : "Send a code"
                        : "Sign in"}
                  </button>
                </form>

                {mode === "password" ? (
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
                    <span className="text-[var(--sea-ink-soft)]">
                      New here? Use a link or email code.
                    </span>
                    <button
                      type="button"
                      disabled={!email || passwordReset.isPending}
                      className="text-[var(--sea-ink-soft)] disabled:opacity-40"
                      onClick={() => passwordReset.mutate()}
                    >
                      Forgot password?
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function SignedIn({
  bootstrapError,
  bootstrapResult,
  userId,
  isBootstrapPending,
  isPending,
  onBootstrap,
  onLogout,
}: {
  bootstrapError: Error | null;
  bootstrapResult?: Awaited<ReturnType<typeof bootstrapMailboxOwner>>;
  userId: string;
  isBootstrapPending: boolean;
  isPending: boolean;
  onBootstrap: () => void;
  onLogout: () => void;
}) {
  return (
    <div>
      <div className="flex size-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800">
        <CheckCircle2 size={28} />
      </div>
      <p className="island-kicker mt-8">Session active</p>
      <h2 className="display-title mt-3 text-4xl font-bold">
        You are signed in.
      </h2>
      <p className="mt-4 text-sm leading-6 text-[var(--sea-ink-soft)]">
        Your mailbox workspace is the next stage of the build. Session
        principal: <code>{userId.slice(0, 12)}...</code>
      </p>
      <div className="mt-6">
        {bootstrapResult?.ok ? (
          <div className="space-y-3">
            <Notice>
              Primary inbox ready: {bootstrapResult.mailbox.displayName}
            </Notice>
            <p className="text-sm leading-6 text-[var(--sea-ink-soft)]">
              Mailbox navigation and message views arrive with the next
              MailboxDO and inbox UI stages.
            </p>
          </div>
        ) : bootstrapResult ? (
          <ErrorNotice>{bootstrapResult.error.message}</ErrorNotice>
        ) : bootstrapError ? (
          <ErrorNotice>Mailbox setup request failed. Try again.</ErrorNotice>
        ) : null}
      </div>
      {bootstrapResult?.ok ? null : (
        <button
          type="button"
          onClick={onBootstrap}
          disabled={isBootstrapPending}
          className="mt-8 flex items-center gap-2 rounded-xl bg-[var(--sea-ink)] px-5 py-3 font-bold text-white shadow-lg hover:-translate-y-0.5 disabled:opacity-50"
        >
          {isBootstrapPending ? (
            <LoaderCircle className="animate-spin" size={17} />
          ) : (
            <Mail size={17} />
          )}
          Create primary inbox
        </button>
      )}
      <button
        type="button"
        onClick={onLogout}
        disabled={isPending}
        className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/70 px-5 py-3 font-bold hover:bg-white disabled:opacity-50"
      >
        {isPending ? (
          <LoaderCircle className="animate-spin" size={17} />
        ) : (
          <LogOut size={17} />
        )}{" "}
        Sign out
      </button>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-emerald-300/60 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-900">
      {children}
    </p>
  );
}

function ErrorNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-red-300/60 bg-red-50/80 px-4 py-3 text-sm text-red-800">
      {children}
    </p>
  );
}
