import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { authClient, authErrorMessage } from "../../auth/client";
import {
  CompletionShell,
  useCompletionCredentials,
} from "../../auth/completion";
import {
  meetsPasswordPolicy,
  minimumPasswordCodePoints,
} from "../../auth/password-policy";

export const Route = createFileRoute("/auth-complete/password-reset")({
  component: PasswordResetCompletion,
});

function PasswordResetCompletion() {
  const credentials = useCompletionCredentials();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const navigate = useNavigate();
  const passwordsMatch = password === confirmation;
  const isReady = Boolean(
    credentials.challengeId &&
    credentials.secret &&
    meetsPasswordPolicy(password) &&
    passwordsMatch
  );

  const verify = useMutation({
    mutationFn: () =>
      authClient.password.reset.verify({
        challengeId: credentials.challengeId,
        password,
        secret: credentials.secret ?? "",
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
          minLength={minimumPasswordCodePoints}
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
          minLength={minimumPasswordCodePoints}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          className="w-full rounded-xl border border-[var(--line)] bg-white/75 px-4 py-3 outline-none focus:border-[var(--lagoon-deep)]"
        />
      </label>
    </CompletionShell>
  );
}
