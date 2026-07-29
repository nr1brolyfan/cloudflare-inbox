import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

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
        code: credentials.secret ?? "",
      }),
    retry: false,
    onSuccess: async () => {
      clearMailboxReadDenial(queryClient);
      await queryClient.invalidateQueries({ queryKey: authSessionQueryKey });
      await navigate({ to: "/" });
    },
  });

  return (
    <CompletionShell
      title="Verify your address"
      description="Confirm this email address to remove limited-session restrictions from your account."
      action="Verify email"
      isReady={Boolean(credentials.challengeId && credentials.secret)}
      isPending={verify.isPending}
      error={verify.error ? authErrorMessage(verify.error) : undefined}
      onSubmit={() => verify.mutate()}
    />
  );
}
