import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { authClient, authErrorMessage } from "../../auth/client";
import { CompletionShell } from "../../auth/completion-shell";

const readString = (value: unknown) => (typeof value === "string" ? value : "");

export const Route = createFileRoute("/auth-complete/password-reset")({
  validateSearch: (search: Record<string, unknown>) => ({
    challengeId: readString(search.challengeId),
    secret: readString(search.secret),
  }),
  component: PasswordResetCompletion,
});

function PasswordResetCompletion() {
  const search = Route.useSearch();
  const [credentials] = useState(search);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const navigate = useNavigate();
  const passwordsMatch = password === confirmation;
  const isReady = Boolean(
    credentials.challengeId &&
    credentials.secret &&
    password.length >= 12 &&
    passwordsMatch
  );

  useEffect(() => {
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const verify = useMutation({
    mutationFn: () =>
      authClient.password.reset.verify({
        ...credentials,
        password,
      }),
    retry: false,
    onSuccess: () => navigate({ to: "/" }),
  });

  return (
    <CompletionShell
      title="Choose a new password"
      description="Resetting your password revokes every active session. You will sign in again when this is complete."
      action="Reset password"
      isReady={isReady}
      isPending={verify.isPending}
      error={
        verify.error
          ? authErrorMessage(verify.error)
          : confirmation && !passwordsMatch
            ? "Passwords do not match."
            : undefined
      }
      onSubmit={() => verify.mutate()}
    >
      <label className="block space-y-2 text-sm font-semibold">
        <span>New password</span>
        <input
          type="password"
          autoComplete="new-password"
          minLength={12}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-xl border border-[var(--line)] bg-white/75 px-4 py-3 outline-none focus:border-[var(--lagoon-deep)]"
        />
      </label>
      <label className="block space-y-2 text-sm font-semibold">
        <span>Confirm password</span>
        <input
          type="password"
          autoComplete="new-password"
          minLength={12}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          className="w-full rounded-xl border border-[var(--line)] bg-white/75 px-4 py-3 outline-none focus:border-[var(--lagoon-deep)]"
        />
      </label>
    </CompletionShell>
  );
}
