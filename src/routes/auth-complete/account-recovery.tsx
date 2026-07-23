import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import {
  authClient,
  authErrorMessage,
  authSessionQueryKey,
  clearMailboxReadDenial,
} from "#/modules/account-security/adapters/browser/AuthClient";
import {
  CompletionShell,
  useCompletionCredentials,
} from "#/modules/account-security/adapters/react/AuthCompletion";

export const Route = createFileRoute("/auth-complete/account-recovery")({
  component: AccountRecoveryCompletion,
});

function AccountRecoveryCompletion() {
  const credentials = useCompletionCredentials();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const complete = useMutation({
    mutationFn: () =>
      authClient.extensions.completeAccountRecovery({
        code,
        flowId: credentials.challengeId,
        secret: credentials.secret ?? "",
      }),
    onSuccess: async () => {
      clearMailboxReadDenial(queryClient);
      await queryClient.invalidateQueries({ queryKey: authSessionQueryKey });
      await navigate({ to: "/" });
    },
    retry: false,
  });

  return (
    <CompletionShell
      title="Continue account recovery"
      description="Enter one unused recovery code. The resulting session can only restore access by enrolling and verifying a passkey."
      action="Use recovery code"
      isReady={Boolean(
        credentials.challengeId && credentials.secret && code.trim()
      )}
      isPending={complete.isPending}
      error={complete.error ? authErrorMessage(complete.error) : undefined}
      onSubmit={() => complete.mutate()}
    >
      <label className="block space-y-2 text-sm font-bold">
        <span>Recovery code</span>
        <input
          type="text"
          required
          autoComplete="one-time-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          className="w-full rounded-xl border border-[var(--line)] bg-white/80 px-4 py-3.5 font-mono uppercase outline-none focus:border-[var(--lagoon-deep)]"
        />
      </label>
    </CompletionShell>
  );
}
