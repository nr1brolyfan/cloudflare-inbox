import {
  authClientErrorMessage,
  createAuthClient,
} from "@effect-auth/core/Client";
import type { QueryClient } from "@tanstack/react-query";

export const authClient = createAuthClient();

export const authSessionQueryKey = ["auth", "session"] as const;

export const toAuthSessionQueryData = <A>(session: A | undefined): A | null =>
  session ?? null;

export const currentSessionForQuery = async (signal?: AbortSignal) =>
  toAuthSessionQueryData(
    await authClient.session.currentOrUndefined({ signal })
  );

export const clearCachedAuthSession = async (queryClient: QueryClient) => {
  queryClient.removeQueries({ queryKey: ["mailbox"] });
  queryClient.setQueryData(authSessionQueryKey, null);
  await queryClient.invalidateQueries({ queryKey: authSessionQueryKey });
};

export const emailIdentity = (email: string) => ({
  identity: {
    kind: "email",
    scope: { type: "global" as const },
    value: email,
  },
});

export const authErrorMessage = (error: unknown) =>
  authClientErrorMessage(error) ?? "Something went wrong. Please try again.";
