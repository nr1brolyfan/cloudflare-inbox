import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { getDevEmailInboxStatus } from "#/apps/website/TanStackFunctions";
import {
  authClient,
  authErrorMessage,
  authSessionQueryKey,
  clearCachedAuthSession,
  clearMailboxReadDenial,
  currentSessionForQuery,
  emailIdentity,
  enrollRecoveryPasskey,
} from "#/modules/account-security/adapters/browser/AuthClient";

import { SignedInOwnerBootstrap } from "./-index-owner-bootstrap";

export const Route = createFileRoute("/")({
  loader: () => getDevEmailInboxStatus(),
  component: Home,
});

type AuthMode = "magic" | "otp" | "passkey" | "password" | "recovery";

const subscribeToPasskeySupport = () => () => null;
const usePasskeySupport = () =>
  useSyncExternalStore(
    subscribeToPasskeySupport,
    () => authClient.passkey.isSupported(),
    () => false
  );

const authModeLabel = (mode: AuthMode) =>
  mode === "magic" ? "Magic link" : mode === "recovery" ? "Recovery" : mode;

function AuthSubmitContent({
  mode,
  otpStarted,
  pending,
}: {
  readonly mode: AuthMode;
  readonly otpStarted: boolean;
  readonly pending: boolean;
}) {
  if (pending) {
    return (
      <>
        <LoaderCircle className="animate-spin" size={18} /> Working...
      </>
    );
  }
  if (mode === "passkey") {
    return (
      <>
        <KeyRound size={18} /> Sign in with a passkey
      </>
    );
  }
  if (mode === "magic") {
    return (
      <>
        <ArrowRight size={18} /> Email me a sign-in link
      </>
    );
  }
  if (mode === "otp") {
    return (
      <>
        <KeyRound size={18} /> {otpStarted ? "Verify code" : "Send a code"}
      </>
    );
  }
  if (mode === "recovery") {
    return (
      <>
        <ShieldCheck size={18} /> Send recovery link
      </>
    );
  }
  return (
    <>
      <ArrowRight size={18} /> Sign in
    </>
  );
}

function DevEmailInboxLink({ enabled }: { readonly enabled: boolean }) {
  if (!enabled) {
    return null;
  }

  return (
    <Link
      to="/dev-email-inbox"
      className="mt-3 inline-flex items-center gap-2 text-xs font-extrabold"
    >
      <Mail size={14} /> Open development email inbox
    </Link>
  );
}

const requiresRecoveryRemediation = (session: {
  readonly claims?: {
    readonly requirements?: readonly string[];
  };
}) =>
  session.claims?.requirements?.length === 1 &&
  session.claims.requirements[0] === "recovery_remediation";

function RecoveryRemediationPanel({
  isLogoutPending,
  onComplete,
  onLogout,
  passkeySupported,
}: {
  readonly isLogoutPending: boolean;
  readonly onComplete: (codes: readonly string[]) => Promise<void>;
  readonly onLogout: () => void;
  readonly passkeySupported: boolean;
}) {
  const enrollment = useMutation({
    gcTime: 0,
    mutationFn: enrollRecoveryPasskey,
    onSuccess: (result) => {
      if (result.type === "recovery-remediation-completed") {
        return onComplete(result.codes);
      }
    },
    retry: false,
  });

  return (
    <div>
      <div className="flex size-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-900">
        <ShieldCheck size={28} />
      </div>
      <p className="island-kicker mt-8">Recovery checkpoint</p>
      <h2 className="display-title mt-3 text-4xl font-bold">
        Secure this account with a passkey.
      </h2>
      <p className="mt-4 text-sm leading-6 text-[var(--sea-ink-soft)]">
        This temporary session cannot open mail or change account settings.
        Create a user-verified passkey to finish recovery. Existing sign-in
        credentials and sessions will be revoked.
      </p>
      {passkeySupported ? null : (
        <ErrorNotice>
          This browser cannot create a passkey. Open the recovery link in a
          passkey-capable browser before the temporary session expires.
        </ErrorNotice>
      )}
      {enrollment.error ? (
        <ErrorNotice>{authErrorMessage(enrollment.error)}</ErrorNotice>
      ) : null}
      {enrollment.data !== undefined &&
      enrollment.data.type !== "recovery-remediation-completed" ? (
        <ErrorNotice>
          Recovery remediation committed, but the one-time session cookie and
          recovery codes cannot be recovered. Sign in with the new passkey, then
          rotate recovery codes before relying on them.
        </ErrorNotice>
      ) : null}
      <button
        type="button"
        disabled={!passkeySupported || enrollment.isPending}
        onClick={() => enrollment.mutate()}
        className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--sea-ink)] px-5 py-3.5 font-bold text-white shadow-lg disabled:opacity-50"
      >
        {enrollment.isPending ? (
          <LoaderCircle className="animate-spin" size={18} />
        ) : (
          <KeyRound size={18} />
        )}
        Create recovery passkey
      </button>
      <button
        type="button"
        disabled={isLogoutPending}
        onClick={onLogout}
        className="mt-3 w-full rounded-xl border border-[var(--line)] bg-white/70 px-5 py-3 font-bold disabled:opacity-50"
      >
        Sign out
      </button>
    </div>
  );
}

function RecoveredCodesPanel({
  codes,
  onSaved,
}: {
  readonly codes: readonly string[];
  readonly onSaved: () => void;
}) {
  return (
    <div>
      <div className="flex size-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-900">
        <ShieldCheck size={28} />
      </div>
      <p className="island-kicker mt-8">Recovery complete</p>
      <h2 className="display-title mt-3 text-4xl font-bold">
        Save your new recovery codes.
      </h2>
      <p className="mt-4 text-sm leading-6 text-[var(--sea-ink-soft)]">
        The previous code set is no longer valid. These codes are shown once and
        are not stored in plaintext.
      </p>
      <div className="mt-6 grid gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-5 font-mono text-sm sm:grid-cols-2">
        {codes.map((code) => (
          <code key={code} className="rounded-lg bg-white px-3 py-2">
            {code}
          </code>
        ))}
      </div>
      <button
        type="button"
        onClick={onSaved}
        className="mt-6 w-full rounded-xl bg-[var(--sea-ink)] px-5 py-3.5 font-bold text-white shadow-lg"
      >
        I saved these codes
      </button>
    </div>
  );
}

// oxlint-disable-next-line eslint/complexity -- The single auth surface exhaustively selects mutually exclusive sign-in and recovery states.
function Home() {
  const devEmailInbox = Route.useLoaderData();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<AuthMode>("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpChallengeId, setOtpChallengeId] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [recoveredCodes, setRecoveredCodes] = useState<readonly string[]>();
  const passkeySupported = usePasskeySupport();
  const authModes: readonly AuthMode[] = passkeySupported
    ? ["passkey", "magic", "otp", "password", "recovery"]
    : ["magic", "otp", "password", "recovery"];

  const session = useQuery({
    queryKey: authSessionQueryKey,
    queryFn: ({ signal }) => currentSessionForQuery(signal),
    retry: false,
  });

  const completeAuthentication = async (result: { type: string }) => {
    if (result.type !== "authenticated") {
      setNotice("This account requires an additional authentication step.");
      return;
    }

    setNotice(undefined);
    clearMailboxReadDenial(queryClient);
    await queryClient.invalidateQueries({ queryKey: authSessionQueryKey });
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

  const passkeyAuth = useMutation({
    mutationFn: () => authClient.passkey.signIn(),
    retry: false,
    onSuccess: completeAuthentication,
  });

  const accountRecovery = useMutation({
    mutationFn: () =>
      authClient.extensions.startAccountRecovery({ address: email }),
    onSuccess: () =>
      setNotice(
        "If this is a verified recovery address with active codes, a recovery link is on its way."
      ),
    retry: false,
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
    onSuccess: () => {
      setRecoveredCodes(undefined);
      return clearCachedAuthSession(queryClient);
    },
  });

  const completeRecoveryRemediation = async (codes: readonly string[]) => {
    setRecoveredCodes(codes);
    clearMailboxReadDenial(queryClient);
    await queryClient.invalidateQueries({ queryKey: authSessionQueryKey });
  };

  const activeMutation =
    mode === "magic"
      ? magicLink
      : mode === "otp"
        ? otpChallengeId
          ? otpVerify
          : otpStart
        : mode === "passkey"
          ? passkeyAuth
          : mode === "recovery"
            ? accountRecovery
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
            ) : recoveredCodes ? (
              <RecoveredCodesPanel
                codes={recoveredCodes}
                onSaved={() => setRecoveredCodes(undefined)}
              />
            ) : session.data && requiresRecoveryRemediation(session.data) ? (
              <RecoveryRemediationPanel
                isLogoutPending={logout.isPending}
                onComplete={completeRecoveryRemediation}
                onLogout={() => logout.mutate()}
                passkeySupported={passkeySupported}
              />
            ) : session.data ? (
              <SignedInOwnerBootstrap
                key={session.data.userId}
                userId={session.data.userId}
                sessionId={session.data.sessionId}
                isLogoutPending={logout.isPending}
                onMailboxFound={() => navigate({ replace: true, to: "/inbox" })}
                onLogout={() => logout.mutate()}
              />
            ) : (
              <>
                <p className="island-kicker">Welcome back</p>
                <h2 className="display-title mt-3 text-4xl font-bold tracking-tight">
                  Sign in to your inbox
                </h2>
                <p className="mt-3 text-sm leading-6 text-[var(--sea-ink-soft)]">
                  Use a passkey, one-time link, email code, or your password.
                </p>
                <DevEmailInboxLink enabled={devEmailInbox.enabled} />

                <div className="mt-7 grid grid-cols-2 rounded-xl bg-[var(--sand)]/75 p-1 sm:grid-cols-5">
                  {authModes.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setMode(value);
                        setNotice(undefined);
                      }}
                      className={`rounded-lg px-2 py-2.5 text-xs font-bold capitalize ${mode === value ? "bg-white text-[var(--sea-ink)] shadow-sm" : "text-[var(--sea-ink-soft)]"}`}
                    >
                      {authModeLabel(value)}
                    </button>
                  ))}
                </div>

                <form className="mt-7 space-y-5" onSubmit={submit}>
                  {mode === "passkey" ? (
                    <p className="rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-4 text-sm leading-6 text-[var(--sea-ink-soft)]">
                      Your browser will ask for a discoverable passkey. No email
                      address or account identifier is sent first.
                    </p>
                  ) : (
                    <label className="block space-y-2 text-sm font-bold">
                      <span>
                        {mode === "recovery"
                          ? "Verified recovery address"
                          : "Email address"}
                      </span>
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className="w-full rounded-xl border border-[var(--line)] bg-white/80 px-4 py-3.5 outline-none focus:border-[var(--lagoon-deep)]"
                      />
                    </label>
                  )}

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
                    <AuthSubmitContent
                      mode={mode}
                      otpStarted={otpChallengeId !== undefined}
                      pending={activeMutation.isPending}
                    />
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
