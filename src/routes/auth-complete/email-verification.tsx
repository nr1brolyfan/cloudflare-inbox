import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import {
  authClient,
  authErrorMessage,
  authSessionQueryKey,
} from "../../auth/client";
import { CompletionShell } from "../../auth/completion-shell";
import { useCompletionCredentials } from "../../auth/use-completion-credentials";

export const Route = createFileRoute("/auth-complete/email-verification")({
  component: EmailVerificationCompletion,
});

function EmailVerificationCompletion() {
  const credentials = useCompletionCredentials();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const verify = useMutation({
    mutationFn: () =>
      authClient.emailVerification.verify({
        challengeId: credentials.challengeId,
        ...(credentials.secret ? { secret: credentials.secret } : {}),
      }),
    retry: false,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authSessionQueryKey });
      await navigate({ to: "/" });
    },
  });

  return (
    <CompletionShell
      title="Verify your address"
      description="Confirm this email address to remove limited-session restrictions from your account."
      action="Verify email"
      isReady={Boolean(credentials.challengeId)}
      isPending={verify.isPending}
      error={verify.error ? authErrorMessage(verify.error) : undefined}
      onSubmit={() => verify.mutate()}
    />
  );
}
