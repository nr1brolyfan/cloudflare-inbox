import type { QueryClient } from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  KeyRound,
  LoaderCircle,
  LogOut,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import {
  bootstrapMailboxOwner,
  getMailboxNavigation,
  readMailboxAdministrationOperation,
} from "#/apps/website/TanStackFunctions";
import {
  authClient,
  authErrorMessage,
  authSessionQueryKey,
  clearCachedAuthSession,
} from "#/modules/account-security/adapters/browser/AuthClient";

const subscribeToPasskeySupport = () => () => null;
const usePasskeySupport = () =>
  useSyncExternalStore(
    subscribeToPasskeySupport,
    () => authClient.passkey.isSupported(),
    () => false
  );

const useOwnerBootstrap = (queryClient: QueryClient, userId: string) => {
  const [stepUpPassword, setStepUpPassword] = useState("");
  const [firstPassword, setFirstPassword] = useState("");
  const [firstPasswordConfirmation, setFirstPasswordConfirmation] =
    useState("");
  const [firstPasswordCommitted, setFirstPasswordCommitted] = useState(false);
  const [stepUpComplete, setStepUpComplete] = useState(false);
  const [operationId] = useState(() => crypto.randomUUID());
  const [passwordEnrollmentOperationId] = useState(() => crypto.randomUUID());
  const mailboxBootstrap = useMutation({
    mutationFn: async (
      acknowledgedRecoveryCodeRotationOperationId?: string
    ) => {
      const readback = async () => {
        const result = await readMailboxAdministrationOperation({
          data: { operationId },
        });
        return result.ok
          ? ({ ok: true, mailbox: result.receipt.result } as const)
          : null;
      };
      try {
        const result = await bootstrapMailboxOwner({
          data: {
            ...(acknowledgedRecoveryCodeRotationOperationId === undefined
              ? {}
              : { acknowledgedRecoveryCodeRotationOperationId }),
            displayName: "Inbox",
            operationId,
          },
        });
        if (!result.ok && (result.status === 500 || result.status === 502)) {
          return (await readback()) ?? result;
        }
        return result;
      } catch (error) {
        const recovered = await readback().catch(() => null);
        if (recovered !== null) {
          return recovered;
        }
        throw error;
      }
    },
    onSuccess: async (result) => {
      if (!result.ok && result.status === 401) {
        await clearCachedAuthSession(queryClient);
      }
      if (!result.ok && result.error.code === "step_up_required") {
        setStepUpComplete(false);
      }
    },
    retry: false,
  });
  const stepUpOptions = useQuery({
    enabled: !stepUpComplete,
    queryFn: () => authClient.stepUp.options(),
    queryKey: ["auth", "step-up-options", userId] as const,
    retry: false,
  });
  const passwordStepUp = useMutation({
    mutationFn: () =>
      authClient.stepUp.password.verify({ password: stepUpPassword }),
    onSettled: () => setStepUpPassword(""),
    onSuccess: async () => {
      setStepUpComplete(true);
      await queryClient.invalidateQueries({ queryKey: authSessionQueryKey });
    },
    retry: false,
  });
  const firstPasswordEnrollment = useMutation({
    mutationFn: async () => {
      if (firstPassword !== firstPasswordConfirmation) {
        throw new Error("Passwords do not match");
      }
      await authClient.extensions.enrollFirstOwnerPassword({
        operationId: passwordEnrollmentOperationId,
        password: firstPassword,
      });
      setFirstPasswordCommitted(true);
      await authClient.stepUp.password.verify({ password: firstPassword });
    },
    onSettled: async (_result, error) => {
      setFirstPassword("");
      setFirstPasswordConfirmation("");
      if (error !== null) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: authSessionQueryKey }),
          queryClient.invalidateQueries({
            queryKey: ["auth", "step-up-options", userId],
          }),
        ]);
      }
    },
    onSuccess: async () => {
      setStepUpComplete(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: authSessionQueryKey }),
        queryClient.invalidateQueries({
          queryKey: ["auth", "step-up-options", userId],
        }),
      ]);
    },
    retry: false,
  });

  return {
    firstPassword,
    firstPasswordCommitted,
    firstPasswordConfirmation,
    firstPasswordEnrollment,
    handleFirstPasswordChange: setFirstPassword,
    handleFirstPasswordConfirmationChange: setFirstPasswordConfirmation,
    handlePasskeyStepUp: () => {
      setStepUpComplete(true);
    },
    handleBootstrap: (acknowledgedRecoveryCodeRotationOperationId?: string) =>
      mailboxBootstrap.mutateAsync(acknowledgedRecoveryCodeRotationOperationId),
    handleStepUpPasswordChange: setStepUpPassword,
    mailboxBootstrap,
    passwordStepUp,
    stepUpComplete,
    stepUpOptions,
    stepUpPassword,
    stepUpPasswordAvailable:
      firstPasswordCommitted ||
      (stepUpOptions.data?.factors.some(
        (factor) => factor.type === "password"
      ) ??
        false),
  };
};

function FirstOwnerPasswordPanel({
  confirmation,
  enrollmentError,
  isPending,
  onConfirmationChange,
  onPasswordChange,
  onReauthenticate,
  onSubmit,
  password,
}: {
  readonly confirmation: string;
  readonly enrollmentError: Error | null;
  readonly isPending: boolean;
  readonly onConfirmationChange: (password: string) => void;
  readonly onPasswordChange: (password: string) => void;
  readonly onReauthenticate: () => void;
  readonly onSubmit: () => void;
  readonly password: string;
}) {
  const reauthenticationRequired = hasAuthErrorCode(
    enrollmentError,
    "step_up_required"
  );

  return (
    <div className="mt-8 rounded-2xl border border-[var(--line)] bg-white/70 p-5">
      <p className="island-kicker">First owner security</p>
      <h3 className="mt-2 text-xl font-bold">Create your first password</h3>
      <p className="mt-2 text-sm leading-6 text-[var(--sea-ink-soft)]">
        Your recent email sign-in proves ownership. Create a password now so it
        can immediately confirm the primary inbox setup.
      </p>
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label className="block space-y-2 text-sm font-bold">
          <span>New password</span>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            className="w-full rounded-xl border border-[var(--line)] bg-white/80 px-4 py-3 outline-none focus:border-[var(--lagoon-deep)]"
          />
        </label>
        <label className="block space-y-2 text-sm font-bold">
          <span>Confirm password</span>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => onConfirmationChange(event.target.value)}
            className="w-full rounded-xl border border-[var(--line)] bg-white/80 px-4 py-3 outline-none focus:border-[var(--lagoon-deep)]"
          />
        </label>
        {reauthenticationRequired ? (
          <ErrorNotice>
            Your email proof has expired. Sign out, use a fresh email sign-in
            link, and create the password within five minutes.
          </ErrorNotice>
        ) : enrollmentError ? (
          <ErrorNotice>{authErrorMessage(enrollmentError)}</ErrorNotice>
        ) : null}
        {reauthenticationRequired ? (
          <button
            type="button"
            onClick={onReauthenticate}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--sea-ink)] px-5 py-3 font-bold text-white shadow-lg"
          >
            <LogOut size={17} /> Sign out and use a fresh link
          </button>
        ) : (
          <button
            type="submit"
            disabled={isPending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--sea-ink)] px-5 py-3 font-bold text-white shadow-lg disabled:opacity-50"
          >
            {isPending ? (
              <LoaderCircle className="animate-spin" size={17} />
            ) : (
              <ShieldCheck size={17} />
            )}
            Create password and confirm
          </button>
        )}
      </form>
    </div>
  );
}

function StepUpPanel({
  description = "Creating the primary inbox grants ownership and configures its initial address. Re-enter your password to continue.",
  isPending,
  onPasswordChange,
  onPasskeySuccess,
  onSubmit,
  optionsError,
  optionsPending,
  password,
  passwordAvailable,
  passwordError,
  passkeyAvailable,
  title = "Confirm this ownership action",
}: {
  readonly description?: string;
  readonly isPending: boolean;
  readonly onPasswordChange: (password: string) => void;
  readonly onPasskeySuccess: () => Promise<void> | void;
  readonly onSubmit: () => void;
  readonly optionsError: Error | null;
  readonly optionsPending: boolean;
  readonly password: string;
  readonly passwordAvailable: boolean;
  readonly passwordError: Error | null;
  readonly passkeyAvailable: boolean;
  readonly title?: string;
}) {
  const queryClient = useQueryClient();
  const passkeySupported = usePasskeySupport();
  const passkeyStepUp = useMutation({
    mutationFn: () => authClient.stepUp.passkey.verify(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authSessionQueryKey });
      await onPasskeySuccess();
    },
    retry: false,
  });

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
      ) : passwordAvailable || (passkeyAvailable && passkeySupported) ? (
        <div className="mt-5 space-y-4">
          {passkeyAvailable && passkeySupported ? (
            <div className="space-y-3">
              <button
                type="button"
                disabled={passkeyStepUp.isPending || isPending}
                onClick={() => passkeyStepUp.mutate()}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--sea-ink)] px-5 py-3 font-bold text-white shadow-lg disabled:opacity-50"
              >
                {passkeyStepUp.isPending ? (
                  <LoaderCircle className="animate-spin" size={17} />
                ) : (
                  <KeyRound size={17} />
                )}
                Confirm with passkey
              </button>
              {passkeyStepUp.error ? (
                <ErrorNotice>
                  {authErrorMessage(passkeyStepUp.error)}
                </ErrorNotice>
              ) : null}
            </div>
          ) : null}
          {passwordAvailable ? (
            <form
              className="space-y-4"
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
                disabled={isPending || passkeyStepUp.isPending}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-white px-5 py-3 font-bold text-[var(--sea-ink)] shadow-sm disabled:opacity-50"
              >
                {isPending ? (
                  <LoaderCircle className="animate-spin" size={17} />
                ) : (
                  <ShieldCheck size={17} />
                )}
                Confirm with password
              </button>
            </form>
          ) : null}
        </div>
      ) : (
        <ErrorNotice>
          {passkeyAvailable
            ? "This browser does not support the passkey required for this action."
            : "This account has no independently established step-up method, so it cannot authorize a new ownership or authentication factor."}
        </ErrorNotice>
      )}
    </div>
  );
}

const hasStepUpFactor = (
  data: { readonly factors: readonly { readonly type: string }[] } | undefined,
  type: "passkey" | "password"
) => data?.factors.some((factor) => factor.type === type) ?? false;

const hasAuthErrorCode = (error: unknown, code: string) =>
  error !== null &&
  typeof error === "object" &&
  "code" in error &&
  error.code === code;

// oxlint-disable-next-line eslint/complexity -- The bootstrap surface exhaustively selects mailbox, step-up, and one-time first-owner states.
export function SignedInOwnerBootstrap({
  isLogoutPending,
  onMailboxFound,
  onLogout,
  sessionId,
  userId,
}: {
  readonly isLogoutPending: boolean;
  readonly onMailboxFound: () => Promise<void> | void;
  readonly onLogout: () => void;
  readonly sessionId: string;
  readonly userId: string;
}) {
  const queryClient = useQueryClient();
  const [provisioning, setProvisioning] = useState<
    "idle" | "preparing" | "timed-out"
  >("idle");
  const navigationQueryKey = [
    "mailbox",
    "navigation",
    userId,
    sessionId,
  ] as const;
  const mailboxNavigation = useQuery({
    queryFn: async () => {
      const previousNavigation = queryClient.getQueryData<{
        readonly ok: boolean;
      }>(navigationQueryKey);
      const result = await getMailboxNavigation();
      if (!result.ok && result.status === 401) {
        await clearCachedAuthSession(queryClient);
      }
      if (
        !result.ok &&
        result.status !== 401 &&
        result.status !== 403 &&
        (result.status !== 404 || previousNavigation?.ok === true)
      ) {
        throw new Error("Mailbox navigation is temporarily unavailable");
      }
      return result;
    },
    queryKey: navigationQueryKey,
    refetchInterval: provisioning === "preparing" ? 1000 : false,
    retry: 2,
    retryDelay: (attempt) => 250 * (attempt + 1),
    staleTime: 30_000,
  });
  const ownerBootstrap = useOwnerBootstrap(queryClient, userId);
  const bootstrapResult = ownerBootstrap.mailboxBootstrap.data;
  const bootstrapAccepted =
    bootstrapResult?.ok === true ||
    (bootstrapResult?.ok === false && bootstrapResult.status === 409);
  const firstPasswordNeeded =
    !ownerBootstrap.stepUpComplete &&
    !ownerBootstrap.firstPasswordCommitted &&
    ownerBootstrap.stepUpOptions.isSuccess &&
    !hasStepUpFactor(ownerBootstrap.stepUpOptions.data, "password") &&
    !hasStepUpFactor(ownerBootstrap.stepUpOptions.data, "passkey");
  const stepUpPending = ownerBootstrap.stepUpComplete === false;
  const mailboxReady = mailboxNavigation.data?.ok === true;

  useEffect(() => {
    if (provisioning !== "preparing") {
      return;
    }
    const timeout = window.setTimeout(
      () => setProvisioning("timed-out"),
      20_000
    );
    return () => window.clearTimeout(timeout);
  }, [provisioning]);

  useEffect(() => {
    if (mailboxReady) {
      void onMailboxFound();
    }
  }, [mailboxReady, onMailboxFound]);

  const handleBootstrap = async () => {
    try {
      const result = await ownerBootstrap.handleBootstrap();
      if (result.ok || result.status === 409) {
        setProvisioning("preparing");
        await queryClient.invalidateQueries({ queryKey: navigationQueryKey });
      }
    } catch {
      // The mutation exposes the actionable error in the onboarding panel.
    }
  };

  if (
    mailboxNavigation.isPending ||
    (mailboxNavigation.isFetching && mailboxNavigation.data?.ok !== true) ||
    mailboxReady ||
    (bootstrapAccepted && provisioning !== "timed-out")
  ) {
    return (
      <output className="flex flex-col items-center justify-center gap-3 py-24 text-center text-[var(--sea-ink-soft)]">
        <LoaderCircle aria-label="Loading mailbox" className="animate-spin" />
        {bootstrapAccepted ? <span>Preparing your inbox...</span> : null}
      </output>
    );
  }

  if (provisioning === "timed-out") {
    return (
      <div>
        <ErrorNotice>
          Your inbox is taking longer than expected to become ready.
        </ErrorNotice>
        <button
          type="button"
          onClick={() => {
            setProvisioning("preparing");
            void mailboxNavigation.refetch();
          }}
          className="mt-5 rounded-xl bg-[var(--sea-ink)] px-5 py-3 font-bold text-white shadow-lg"
        >
          Check again
        </button>
        <button
          type="button"
          onClick={onLogout}
          disabled={isLogoutPending}
          className="mt-3 ml-3 rounded-xl border border-[var(--line)] bg-white/70 px-5 py-3 font-bold disabled:opacity-50"
        >
          Sign out
        </button>
      </div>
    );
  }

  if (
    mailboxNavigation.error ||
    (mailboxNavigation.data.ok === false &&
      mailboxNavigation.data.status !== 404)
  ) {
    return (
      <div>
        <ErrorNotice>
          We could not check whether your primary inbox already exists. Try
          again before starting setup.
        </ErrorNotice>
        <button
          type="button"
          onClick={() => void mailboxNavigation.refetch()}
          className="mt-5 rounded-xl bg-[var(--sea-ink)] px-5 py-3 font-bold text-white shadow-lg"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={onLogout}
          disabled={isLogoutPending}
          className="mt-3 ml-3 rounded-xl border border-[var(--line)] bg-white/70 px-5 py-3 font-bold disabled:opacity-50"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="display-title text-4xl font-bold">Set up your inbox</h2>
      <p className="mt-4 text-sm leading-6 text-[var(--sea-ink-soft)]">
        Confirm this account once, then create your primary inbox.
      </p>
      <div className="mt-6">
        {bootstrapResult?.ok === false && bootstrapResult.status !== 409 ? (
          <ErrorNotice>{bootstrapResult.error.message}</ErrorNotice>
        ) : ownerBootstrap.mailboxBootstrap.error ? (
          <ErrorNotice>Mailbox setup request failed. Try again.</ErrorNotice>
        ) : null}
      </div>
      {firstPasswordNeeded ? (
        <FirstOwnerPasswordPanel
          confirmation={ownerBootstrap.firstPasswordConfirmation}
          enrollmentError={ownerBootstrap.firstPasswordEnrollment.error}
          isPending={ownerBootstrap.firstPasswordEnrollment.isPending}
          onConfirmationChange={
            ownerBootstrap.handleFirstPasswordConfirmationChange
          }
          onPasswordChange={ownerBootstrap.handleFirstPasswordChange}
          onReauthenticate={onLogout}
          onSubmit={() => ownerBootstrap.firstPasswordEnrollment.mutate()}
          password={ownerBootstrap.firstPassword}
        />
      ) : stepUpPending ? (
        <StepUpPanel
          isPending={ownerBootstrap.passwordStepUp.isPending}
          onPasswordChange={ownerBootstrap.handleStepUpPasswordChange}
          onPasskeySuccess={ownerBootstrap.handlePasskeyStepUp}
          onSubmit={() => ownerBootstrap.passwordStepUp.mutate()}
          optionsError={ownerBootstrap.stepUpOptions.error}
          optionsPending={ownerBootstrap.stepUpOptions.isPending}
          password={ownerBootstrap.stepUpPassword}
          passkeyAvailable={hasStepUpFactor(
            ownerBootstrap.stepUpOptions.data,
            "passkey"
          )}
          passwordAvailable={ownerBootstrap.stepUpPasswordAvailable}
          passwordError={ownerBootstrap.passwordStepUp.error}
        />
      ) : (
        <section className="mt-8">
          <button
            type="button"
            onClick={() => void handleBootstrap()}
            disabled={ownerBootstrap.mailboxBootstrap.isPending}
            className="flex items-center gap-2 rounded-xl bg-[var(--sea-ink)] px-5 py-3 font-bold text-white shadow-lg hover:-translate-y-0.5 disabled:opacity-50"
          >
            {ownerBootstrap.mailboxBootstrap.isPending ? (
              <LoaderCircle className="animate-spin" size={17} />
            ) : (
              <Mail size={17} />
            )}
            Create primary inbox
          </button>
        </section>
      )}
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
