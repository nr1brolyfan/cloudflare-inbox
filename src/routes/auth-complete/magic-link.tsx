import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import {
  authClient,
  authErrorMessage,
  authSessionQueryKey,
} from "../../auth/client";
import {
  CompletionShell,
  useCompletionCredentials,
} from "../../auth/completion";

export const Route = createFileRoute("/auth-complete/magic-link")({
  component: MagicLinkCompletion,
});

function MagicLinkCompletion() {
  const credentials = useCompletionCredentials();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const verify = useMutation({
    mutationFn: () =>
      authClient.magicLink.verify({
        challengeId: credentials.challengeId,
        secret: credentials.secret ?? "",
      }),
    retry: false,
    onSuccess: async (result) => {
      if (result.type !== "authenticated") {
        return;
      }
      await queryClient.invalidateQueries({ queryKey: authSessionQueryKey });
      await navigate({ to: "/" });
    },
  });

  return (
    <CompletionShell
      title="Open your inbox"
      description="This one-time link proves access to your email address. Continue only if you requested it."
      action="Continue securely"
      isReady={Boolean(credentials.challengeId && credentials.secret)}
      isPending={verify.isPending}
      error={verify.error ? authErrorMessage(verify.error) : undefined}
      onSubmit={() => verify.mutate()}
    />
  );
}
