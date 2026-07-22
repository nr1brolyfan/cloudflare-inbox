import type { QueryClient } from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  LogOut,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";

import {
  authClient,
  authErrorMessage,
  authSessionQueryKey,
  clearCachedAuthSession,
} from "../auth/client";
import { bootstrapMailboxOwner } from "../server/tanstack-functions";

const useOwnerBootstrap = (queryClient: QueryClient, userId: string) => {
  const [stepUpPassword, setStepUpPassword] = useState("");
  const [stepUpComplete, setStepUpComplete] = useState(false);
  const mailboxBootstrap = useMutation({
    mutationFn: () =>
      bootstrapMailboxOwner({
        data: { displayName: "Inbox", operationId: crypto.randomUUID() },
      }),
    onSuccess: async (result) => {
      if (!result.ok && result.status === 401) {
        await clearCachedAuthSession(queryClient);
      }
    },
    retry: false,
  });
  const stepUpRequired =
    mailboxBootstrap.data?.ok === false &&
    mailboxBootstrap.data.error.code === "step_up_required";
  const stepUpOptions = useQuery({
    enabled: stepUpRequired,
    queryFn: () => authClient.stepUp.options(),
    queryKey: ["auth", "step-up-options", userId] as const,
    retry: false,
  });
  const passwordStepUp = useMutation({
    mutationFn: () =>
      authClient.stepUp.password.verify({ password: stepUpPassword }),
    onSuccess: async () => {
      setStepUpPassword("");
      setStepUpComplete(true);
      mailboxBootstrap.reset();
      await queryClient.invalidateQueries({ queryKey: authSessionQueryKey });
    },
    retry: false,
  });

  return {
    handleBootstrap: () => {
      setStepUpComplete(false);
      mailboxBootstrap.mutate();
    },
    handleStepUpPasswordChange: setStepUpPassword,
    mailboxBootstrap,
    passwordStepUp,
    stepUpComplete,
    stepUpOptions,
    stepUpPassword,
    stepUpPasswordAvailable:
      stepUpOptions.data?.factors.some(
        (factor) => factor.type === "password"
      ) ?? false,
  };
};

function StepUpPanel({
  description = "Creating the primary inbox grants ownership and configures its initial address. Re-enter your password to continue.",
  isPending,
  onPasswordChange,
  onSubmit,
  optionsError,
  optionsPending,
  password,
  passwordAvailable,
  passwordError,
  title = "Confirm this ownership action",
}: {
  readonly description?: string;
  readonly isPending: boolean;
  readonly onPasswordChange: (password: string) => void;
  readonly onSubmit: () => void;
  readonly optionsError: Error | null;
  readonly optionsPending: boolean;
  readonly password: string;
  readonly passwordAvailable: boolean;
  readonly passwordError: Error | null;
  readonly title?: string;
}) {
  return (
    <div className="mt-8 rounded-2xl border border-[var(--line)] bg-white/70 p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--sand)] text-[var(--sea-ink)]">
          <ShieldCheck size={18} />
        </span>
        <div>
          <p className="font-bold">{title}</p>
          <p className="mt-1 text-sm leading-6 text-[var(--sea-ink-soft)]">
            {description}
          </p>
        </div>
      </div>
      {optionsPending ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-[var(--sea-ink-soft)]">
          <LoaderCircle className="animate-spin" size={16} /> Checking available
          methods...
        </p>
      ) : optionsError ? (
        <ErrorNotice>{authErrorMessage(optionsError)}</ErrorNotice>
      ) : passwordAvailable ? (
        <form
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <label className="block space-y-2 text-sm font-bold">
            <span>Password</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              className="w-full rounded-xl border border-[var(--line)] bg-white/80 px-4 py-3 outline-none focus:border-[var(--lagoon-deep)]"
            />
          </label>
          {passwordError ? (
            <ErrorNotice>{authErrorMessage(passwordError)}</ErrorNotice>
          ) : null}
          <button
            type="submit"
            disabled={isPending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--sea-ink)] px-5 py-3 font-bold text-white shadow-lg disabled:opacity-50"
          >
            {isPending ? (
              <LoaderCircle className="animate-spin" size={17} />
            ) : (
              <KeyRound size={17} />
            )}
            Confirm identity
          </button>
        </form>
      ) : (
        <ErrorNotice>
          This account has no independently established step-up method, so it
          cannot authorize a new ownership or authentication factor.
        </ErrorNotice>
      )}
    </div>
  );
}

function ExternalRecoveryEnrollment({ userId }: { readonly userId: string }) {
  const queryClient = useQueryClient();
  const [address, setAddress] = useState("");
  const [operationId] = useState(() => crypto.randomUUID());
  const [password, setPassword] = useState("");
  const enrollment = useMutation({
    mutationFn: () =>
      authClient.extensions.enrollExternalRecoveryIdentity({
        address,
        operationId,
      }),
    retry: false,
  });
  const stepUpRequired =
    enrollment.error !== null &&
    typeof enrollment.error === "object" &&
    "code" in enrollment.error &&
    enrollment.error.code === "step_up_required";
  const stepUpOptions = useQuery({
    enabled: stepUpRequired,
    queryFn: () => authClient.stepUp.options(),
    queryKey: ["auth", "recovery-step-up-options", userId] as const,
    retry: false,
  });
  const passwordStepUp = useMutation({
    mutationFn: () => authClient.stepUp.password.verify({ password }),
    onSuccess: async () => {
      setPassword("");
      enrollment.reset();
      await queryClient.invalidateQueries({ queryKey: authSessionQueryKey });
    },
    retry: false,
  });

  return (
    <section className="mt-8 border-t border-[var(--line)] pt-8">
      <p className="island-kicker">Recovery safety</p>
      <h3 className="mt-2 text-xl font-bold">External recovery address</h3>
      <p className="mt-2 text-sm leading-6 text-[var(--sea-ink-soft)]">
        Use a personal address outside the managed mail domain. It remains
        separate from login identities and mailbox routing.
      </p>
      {enrollment.isSuccess ? (
        <div className="mt-4">
          <Notice>
            Verification email sent. Open its secure link to finish.
          </Notice>
        </div>
      ) : (
        <form
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            enrollment.mutate();
          }}
        >
          <label className="block space-y-2 text-sm font-bold">
            <span>External email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              className="w-full rounded-xl border border-[var(--line)] bg-white/80 px-4 py-3 outline-none focus:border-[var(--lagoon-deep)]"
            />
          </label>
          {enrollment.error && !stepUpRequired ? (
            <ErrorNotice>{authErrorMessage(enrollment.error)}</ErrorNotice>
          ) : null}
          <button
            type="submit"
            disabled={enrollment.isPending}
            className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/80 px-5 py-3 font-bold shadow-sm disabled:opacity-50"
          >
            {enrollment.isPending ? (
              <LoaderCircle className="animate-spin" size={17} />
            ) : (
              <ShieldCheck size={17} />
            )}
            Send verification link
          </button>
        </form>
      )}
      {stepUpRequired ? (
        <StepUpPanel
          title="Confirm recovery enrollment"
          description="Re-enter your password before adding an account recovery channel."
          isPending={passwordStepUp.isPending}
          onPasswordChange={setPassword}
          onSubmit={() => passwordStepUp.mutate()}
          optionsError={stepUpOptions.error}
          optionsPending={stepUpOptions.isPending}
          password={password}
          passwordAvailable={
            stepUpOptions.data?.factors.some(
              (factor) => factor.type === "password"
            ) ?? false
          }
          passwordError={passwordStepUp.error}
        />
      ) : null}
    </section>
  );
}

function PasskeyEnrollment({ userId }: { readonly userId: string }) {
  const queryClient = useQueryClient();
  const supported = authClient.passkey.isSupported();
  const [password, setPassword] = useState("");
  const enrollment = useMutation({
    mutationFn: () => authClient.passkey.register(),
    retry: false,
  });
  const stepUpRequired =
    enrollment.error !== null &&
    typeof enrollment.error === "object" &&
    "code" in enrollment.error &&
    enrollment.error.code === "step_up_required";
  const options = useQuery({
    enabled: stepUpRequired,
    queryFn: () => authClient.stepUp.options(),
    queryKey: ["auth", "passkey-enrollment-step-up", userId] as const,
    retry: false,
  });
  const passwordStepUp = useMutation({
    mutationFn: () => authClient.stepUp.password.verify({ password }),
    onSuccess: async () => {
      setPassword("");
      enrollment.reset();
      await queryClient.invalidateQueries({ queryKey: authSessionQueryKey });
    },
    retry: false,
  });

  return (
    <section className="mt-8 border-t border-[var(--line)] pt-8">
      <p className="island-kicker">Passkey-first access</p>
      <h3 className="mt-2 text-xl font-bold">Enroll a passkey</h3>
      <p className="mt-2 text-sm leading-6 text-[var(--sea-ink-soft)]">
        Enrollment requires recent authentication and a verified external
        recovery address. Sign-in and passkey recovery remain disabled.
      </p>
      {supported ? (
        enrollment.isSuccess ? (
          <div className="mt-4">
            <Notice>Passkey enrolled for this account.</Notice>
          </div>
        ) : (
          <div className="mt-5">
            {enrollment.error && !stepUpRequired ? (
              <ErrorNotice>{authErrorMessage(enrollment.error)}</ErrorNotice>
            ) : null}
            <button
              type="button"
              onClick={() => enrollment.mutate()}
              disabled={enrollment.isPending}
              className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/80 px-5 py-3 font-bold shadow-sm disabled:opacity-50"
            >
              {enrollment.isPending ? (
                <LoaderCircle className="animate-spin" size={17} />
              ) : (
                <KeyRound size={17} />
              )}
              Create passkey
            </button>
          </div>
        )
      ) : (
        <ErrorNotice>This browser does not support passkeys.</ErrorNotice>
      )}
      {stepUpRequired ? (
        <StepUpPanel
          title="Confirm passkey enrollment"
          description="Re-enter your password before creating a new authentication factor."
          isPending={passwordStepUp.isPending}
          onPasswordChange={setPassword}
          onSubmit={() => passwordStepUp.mutate()}
          optionsError={options.error}
          optionsPending={options.isPending}
          password={password}
          passwordAvailable={
            options.data?.factors.some(
              (factor) => factor.type === "password"
            ) ?? false
          }
          passwordError={passwordStepUp.error}
        />
      ) : null}
    </section>
  );
}

export function SignedInOwnerBootstrap({
  isLogoutPending,
  onLogout,
  userId,
}: {
  readonly isLogoutPending: boolean;
  readonly onLogout: () => void;
  readonly userId: string;
}) {
  const queryClient = useQueryClient();
  const ownerBootstrap = useOwnerBootstrap(queryClient, userId);
  const bootstrapResult = ownerBootstrap.mailboxBootstrap.data;
  const mailboxExists =
    bootstrapResult?.ok === false && bootstrapResult.status === 409;
  const mailboxKnown = bootstrapResult?.ok === true || mailboxExists;
  const stepUpRequired =
    bootstrapResult?.ok === false &&
    bootstrapResult.error.code === "step_up_required";

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
        Mailbox access is verified when you open the workspace. Session
        principal: <code>{userId.slice(0, 12)}...</code>
      </p>
      <div className="mt-6">
        {bootstrapResult?.ok ? (
          <div className="space-y-3">
            <Notice>
              Primary inbox ready: {bootstrapResult.mailbox.displayName}
            </Notice>
            <p className="text-sm leading-6 text-[var(--sea-ink-soft)]">
              Open the responsive workspace to continue to your mailbox.
            </p>
          </div>
        ) : mailboxExists ? (
          <Notice>
            A primary inbox already exists. Open it to verify your access.
          </Notice>
        ) : bootstrapResult && !stepUpRequired ? (
          <ErrorNotice>{bootstrapResult.error.message}</ErrorNotice>
        ) : ownerBootstrap.mailboxBootstrap.error ? (
          <ErrorNotice>Mailbox setup request failed. Try again.</ErrorNotice>
        ) : null}
        {ownerBootstrap.stepUpComplete ? (
          <Notice>
            Identity confirmed for five minutes. Create the inbox when ready.
          </Notice>
        ) : null}
      </div>
      {stepUpRequired ? (
        <StepUpPanel
          isPending={ownerBootstrap.passwordStepUp.isPending}
          onPasswordChange={ownerBootstrap.handleStepUpPasswordChange}
          onSubmit={() => ownerBootstrap.passwordStepUp.mutate()}
          optionsError={ownerBootstrap.stepUpOptions.error}
          optionsPending={ownerBootstrap.stepUpOptions.isPending}
          password={ownerBootstrap.stepUpPassword}
          passwordAvailable={ownerBootstrap.stepUpPasswordAvailable}
          passwordError={ownerBootstrap.passwordStepUp.error}
        />
      ) : mailboxKnown ? null : (
        <button
          type="button"
          onClick={ownerBootstrap.handleBootstrap}
          disabled={ownerBootstrap.mailboxBootstrap.isPending}
          className="mt-8 flex items-center gap-2 rounded-xl bg-[var(--sea-ink)] px-5 py-3 font-bold text-white shadow-lg hover:-translate-y-0.5 disabled:opacity-50"
        >
          {ownerBootstrap.mailboxBootstrap.isPending ? (
            <LoaderCircle className="animate-spin" size={17} />
          ) : (
            <Mail size={17} />
          )}
          Create primary inbox
        </button>
      )}
      {mailboxKnown ? (
        <Link
          to="/inbox"
          className="mt-8 flex w-fit items-center gap-2 rounded-xl bg-[var(--sea-ink)] px-5 py-3 font-bold text-white no-underline shadow-lg hover:-translate-y-0.5 hover:text-white"
        >
          <Mail size={17} /> Open inbox
        </Link>
      ) : null}
      <ExternalRecoveryEnrollment userId={userId} />
      <PasskeyEnrollment userId={userId} />
      <button
        type="button"
        onClick={onLogout}
        disabled={isLogoutPending}
        className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/70 px-5 py-3 font-bold hover:bg-white disabled:opacity-50"
      >
        {isLogoutPending ? (
          <LoaderCircle className="animate-spin" size={17} />
        ) : (
          <LogOut size={17} />
        )}{" "}
        Sign out
      </button>
    </div>
  );
}

export function Notice({ children }: { readonly children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-emerald-300/60 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-900">
      {children}
    </p>
  );
}

export function ErrorNotice({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <p className="rounded-xl border border-red-300/60 bg-red-50/80 px-4 py-3 text-sm text-red-800">
      {children}
    </p>
  );
}
