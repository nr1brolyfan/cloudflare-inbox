import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import {
  authClient,
  authErrorMessage,
} from "#/modules/account-security/adapters/browser/AuthClient";
import {
  CompletionShell,
  useCompletionCredentials,
} from "#/modules/account-security/adapters/react/AuthCompletion";

export const Route = createFileRoute(
  "/auth-complete/external-recovery-identity"
)({ component: ExternalRecoveryIdentityCompletion });

function ExternalRecoveryIdentityCompletion() {
  const credentials = useCompletionCredentials();
  const [operationId] = useState(() => crypto.randomUUID());
  const verify = useMutation({
    mutationFn: () =>
      authClient.extensions.verifyExternalRecoveryIdentity({
        challengeId: credentials.challengeId,
        expectedVersion: 1,
        operationId,
        secret: credentials.secret ?? "",
      }),
    retry: false,
  });

  return (
    <CompletionShell
      title="Verify recovery address"
      description="Confirm this external address for account recovery. It will not become a login email or mailbox route."
      action="Verify recovery address"
      isReady={Boolean(credentials.challengeId && credentials.secret)}
      isPending={verify.isPending}
      error={verify.error ? authErrorMessage(verify.error) : undefined}
      success={
        verify.isSuccess ? "External recovery address verified." : undefined
      }
      onSubmit={() => verify.mutate()}
    />
  );
}
