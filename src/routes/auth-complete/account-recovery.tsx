import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import {
  authClient,
  authErrorMessage,
  authSessionQueryKey,
  clearMailboxReadDenial,
  generateAccountRecoveryReadbackSecret,
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
  const [operationId] = useState(() => crypto.randomUUID());
  const [readbackSecret] = useState(generateAccountRecoveryReadbackSecret);
  const complete = useMutation({
    mutationFn: async () => {
      try {
        const receipt = await authClient.extensions.completeAccountRecovery({
          code,
          flowId: credentials.challengeId,
          operationId,
          readbackSecret,
          secret: credentials.secret ?? "",
        });
        return { _tag: "FirstResponse" as const, receipt };
      } catch (error) {
        const definitive =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code !== "internal_error";
        if (!definitive) {
          const receipt = await authClient.extensions
            .readAccountRecoveryCompletion({ operationId, readbackSecret })
            .catch(() => null);
          if (receipt !== null) {
            return { _tag: "ReceiptOnly" as const, receipt };
          }
        }
        throw error;
      }
    },
    onSuccess: async (result) => {
      if (result._tag === "ReceiptOnly") {
        return;
      }
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
      success={
        complete.data?._tag === "ReceiptOnly"
          ? "Recovery entered remediation, but the one-time restricted session cookie could not be recovered. Restart account recovery from sign-in and use another unused recovery code."
          : undefined
      }
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
          className="w-full rounded-xl border border-[var(--line)] bg-[var(--control-bg)] px-4 py-3.5 font-mono text-[var(--sea-ink)] uppercase outline-none focus:border-[var(--lagoon-deep)]"
        />
      </label>
    </CompletionShell>
  );
}
