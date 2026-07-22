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
  Trash2,
} from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import {
  authClient,
  authErrorMessage,
  authSessionQueryKey,
  clearCachedAuthSession,
} from "../auth/client";
import { bootstrapMailboxOwner } from "../server/tanstack-functions";

const subscribeToPasskeySupport = () => () => null;
const usePasskeySupport = () =>
  useSyncExternalStore(
    subscribeToPasskeySupport,
    () => authClient.passkey.isSupported(),
    () => false
  );

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
    handlePasskeyStepUp: () => {
      setStepUpComplete(true);
      mailboxBootstrap.reset();
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
          onPasskeySuccess={() => enrollment.reset()}
          onSubmit={() => passwordStepUp.mutate()}
          optionsError={stepUpOptions.error}
          optionsPending={stepUpOptions.isPending}
          password={password}
          passkeyAvailable={
            stepUpOptions.data?.factors.some(
              (factor) => factor.type === "passkey"
            ) ?? false
          }
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
  const supported = usePasskeySupport();
  const [password, setPassword] = useState("");
  const enrollment = useMutation({
    mutationFn: () => authClient.passkey.register(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["auth", "passkey-credentials", userId],
      });
    },
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
        recovery address. Sign-in and passkey step-up are enabled; recovery
        codes remain disabled.
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
          onPasskeySuccess={() => enrollment.reset()}
          onSubmit={() => passwordStepUp.mutate()}
          optionsError={options.error}
          optionsPending={options.isPending}
          password={password}
          passkeyAvailable={
            options.data?.factors.some((factor) => factor.type === "passkey") ??
            false
          }
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

const formatCredentialTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);

const hasStepUpFactor = (
  data: { readonly factors: readonly { readonly type: string }[] } | undefined,
  type: "passkey" | "password"
) => data?.factors.some((factor) => factor.type === type) ?? false;

const hasAuthErrorCode = (error: unknown, code: string) =>
  error !== null &&
  typeof error === "object" &&
  "code" in error &&
  error.code === code;

function PasskeyCredentialManagement({ userId }: { readonly userId: string }) {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [revokeCommand, setRevokeCommand] = useState<{
    readonly id: string;
    readonly operationId: string;
  } | null>(null);
  const credentials = useQuery({
    queryFn: async () => {
      try {
        return await authClient.extensions.listPasskeyCredentials();
      } catch (error) {
        if (hasAuthErrorCode(error, "unauthenticated")) {
          await clearCachedAuthSession(queryClient);
        }
        throw error;
      }
    },
    queryKey: ["auth", "passkey-credentials", userId] as const,
    retry: false,
  });
  const revocation = useMutation({
    mutationFn: async (command: {
      readonly id: string;
      readonly operationId: string;
    }) => {
      try {
        return await authClient.extensions.revokePasskeyCredential(command);
      } catch (error) {
        try {
          const receipt = await authClient.extensions.readPasskeyRevocation({
            operationId: command.operationId,
          });
          if (receipt.credential.id === command.id) {
            return receipt;
          }
        } catch (readbackError) {
          // Preserve the original revoke failure when no durable receipt exists.
          if (hasAuthErrorCode(readbackError, "unauthenticated")) {
            await clearCachedAuthSession(queryClient);
          }
        }
        if (hasAuthErrorCode(error, "unauthenticated")) {
          await clearCachedAuthSession(queryClient);
        }
        throw error;
      }
    },
    onSuccess: async () => {
      setRevokeCommand(null);
      await queryClient.invalidateQueries({
        queryKey: ["auth", "passkey-credentials", userId],
      });
    },
    retry: false,
  });
  const stepUpRequired =
    revocation.error !== null &&
    typeof revocation.error === "object" &&
    "code" in revocation.error &&
    revocation.error.code === "step_up_required";
  const options = useQuery({
    enabled: stepUpRequired,
    queryFn: () => authClient.stepUp.options(),
    queryKey: ["auth", "passkey-revocation-step-up", userId] as const,
    retry: false,
  });
  const passwordStepUp = useMutation({
    mutationFn: () => authClient.stepUp.password.verify({ password }),
    onSuccess: async () => {
      setPassword("");
      await queryClient.invalidateQueries({ queryKey: authSessionQueryKey });
      if (revokeCommand !== null) {
        revocation.mutate(revokeCommand);
      }
    },
    retry: false,
  });

  return (
    <section className="mt-8 border-t border-[var(--line)] pt-8">
      <p className="island-kicker">Credential inventory</p>
      <h3 className="mt-2 text-xl font-bold">Your passkeys</h3>
      <p className="mt-2 text-sm leading-6 text-[var(--sea-ink-soft)]">
        Review active passkeys without exposing authenticator secrets. For
        account safety, the final active passkey cannot be revoked.
      </p>
      {credentials.isPending ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-[var(--sea-ink-soft)]">
          <LoaderCircle className="animate-spin" size={16} /> Loading
          passkeys...
        </p>
      ) : credentials.error ? (
        <ErrorNotice>{authErrorMessage(credentials.error)}</ErrorNotice>
      ) : credentials.data.credentials.length === 0 ? (
        <p className="mt-4 rounded-xl border border-[var(--line)] bg-white/60 px-4 py-3 text-sm text-[var(--sea-ink-soft)]">
          No active passkeys are enrolled.
        </p>
      ) : (
        <div className="mt-5 space-y-3">
          {credentials.data.credentials.map((credential, index) => (
            <div
              className="flex flex-col gap-4 rounded-2xl border border-[var(--line)] bg-white/70 p-4 sm:flex-row sm:items-center sm:justify-between"
              key={credential.id}
            >
              <div>
                <p className="font-bold">Passkey {index + 1}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--sea-ink-soft)]">
                  Added {formatCredentialTime(credential.createdAt)}
                  {credential.lastUsedAt === undefined
                    ? " | Not used yet"
                    : ` | Last used ${formatCredentialTime(credential.lastUsedAt)}`}
                </p>
              </div>
              <button
                type="button"
                disabled={revocation.isPending}
                onClick={() => {
                  const command =
                    revokeCommand?.id === credential.id
                      ? revokeCommand
                      : {
                          id: credential.id,
                          operationId: crypto.randomUUID(),
                        };
                  setRevokeCommand(command);
                  revocation.mutate(command);
                }}
                className="flex shrink-0 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-800 disabled:opacity-50"
              >
                {revocation.isPending && revokeCommand?.id === credential.id ? (
                  <LoaderCircle className="animate-spin" size={15} />
                ) : (
                  <Trash2 size={15} />
                )}
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
      {revocation.error && !stepUpRequired ? (
        <ErrorNotice>{authErrorMessage(revocation.error)}</ErrorNotice>
      ) : null}
      {revocation.isSuccess ? (
        <div className="mt-4">
          <Notice>Passkey revoked.</Notice>
        </div>
      ) : null}
      {stepUpRequired ? (
        <StepUpPanel
          title="Confirm passkey revocation"
          description="Re-enter your password before revoking this authentication factor."
          isPending={passwordStepUp.isPending}
          onPasswordChange={setPassword}
          onPasskeySuccess={() => {
            if (revokeCommand !== null) {
              revocation.mutate(revokeCommand);
            }
          }}
          onSubmit={() => passwordStepUp.mutate()}
          optionsError={options.error}
          optionsPending={options.isPending}
          password={password}
          passkeyAvailable={
            options.data?.factors.some((factor) => factor.type === "passkey") ??
            false
          }
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

function RecoveryCodeManagement({ userId }: { readonly userId: string }) {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const generation = useMutation({
    gcTime: 0,
    mutationFn: () => authClient.extensions.generateRecoveryCodes(),
    retry: false,
  });
  const stepUpRequired = hasAuthErrorCode(generation.error, "step_up_required");
  const options = useQuery({
    enabled: stepUpRequired,
    queryFn: () => authClient.stepUp.options(),
    queryKey: ["auth", "recovery-code-step-up", userId] as const,
    retry: false,
  });
  const passwordStepUp = useMutation({
    mutationFn: () => authClient.stepUp.password.verify({ password }),
    onSuccess: async () => {
      setPassword("");
      generation.reset();
      await queryClient.invalidateQueries({ queryKey: authSessionQueryKey });
    },
    retry: false,
  });

  return (
    <section className="mt-8 border-t border-[var(--line)] pt-8">
      <p className="island-kicker">Account recovery</p>
      <h3 className="mt-2 text-xl font-bold">Recovery codes</h3>
      <p className="mt-2 text-sm leading-6 text-[var(--sea-ink-soft)]">
        Generating a set immediately invalidates every previous unused code.
        Account recovery will also require access to your verified external
        recovery address.
      </p>
      {generation.data ? (
        <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-5">
          <p className="font-bold text-amber-950">
            Save these codes now. They will not be shown again.
          </p>
          <div className="mt-4 grid gap-2 font-mono text-sm sm:grid-cols-2">
            {generation.data.codes.map((code) => (
              <code key={code} className="rounded-lg bg-white px-3 py-2">
                {code}
              </code>
            ))}
          </div>
          <button
            type="button"
            onClick={() => generation.reset()}
            className="mt-5 rounded-xl border border-amber-400 bg-white px-4 py-2 text-sm font-bold text-amber-950"
          >
            I saved these codes
          </button>
        </div>
      ) : (
        <div className="mt-5">
          {generation.error && !stepUpRequired ? (
            <ErrorNotice>{authErrorMessage(generation.error)}</ErrorNotice>
          ) : null}
          <button
            type="button"
            disabled={generation.isPending}
            onClick={() => generation.mutate()}
            className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/80 px-5 py-3 font-bold shadow-sm disabled:opacity-50"
          >
            {generation.isPending ? (
              <LoaderCircle className="animate-spin" size={17} />
            ) : (
              <KeyRound size={17} />
            )}
            Generate new recovery codes
          </button>
        </div>
      )}
      {stepUpRequired ? (
        <StepUpPanel
          title="Confirm recovery-code generation"
          description="Use a recently established password or passkey before replacing your recovery codes."
          isPending={passwordStepUp.isPending}
          onPasswordChange={setPassword}
          onPasskeySuccess={() => generation.reset()}
          onSubmit={() => passwordStepUp.mutate()}
          optionsError={options.error}
          optionsPending={options.isPending}
          password={password}
          passkeyAvailable={hasStepUpFactor(options.data, "passkey")}
          passwordAvailable={hasStepUpFactor(options.data, "password")}
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
      <PasskeyCredentialManagement userId={userId} />
      <RecoveryCodeManagement userId={userId} />
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
