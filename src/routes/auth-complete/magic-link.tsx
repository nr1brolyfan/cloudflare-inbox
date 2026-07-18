import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { authClient, authErrorMessage } from "../../auth/client";
import { CompletionShell } from "../../auth/completion-shell";

const readString = (value: unknown) => (typeof value === "string" ? value : "");

export const Route = createFileRoute("/auth-complete/magic-link")({
  validateSearch: (search: Record<string, unknown>) => ({
    challengeId: readString(search.challengeId),
    secret: readString(search.secret),
  }),
  component: MagicLinkCompletion,
});

function MagicLinkCompletion() {
  const search = Route.useSearch();
  const [credentials] = useState(search);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const verify = useMutation({
    mutationFn: () => authClient.magicLink.verify(credentials),
    retry: false,
    onSuccess: async (result) => {
      if (result.type !== "authenticated") {
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
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
