import {
  authClientErrorMessage,
  createAuthClient,
} from "@effect-auth/core/Client";

export const authClient = createAuthClient();

export const emailIdentity = (email: string) => ({
  identity: {
    kind: "email",
    scope: { type: "global" as const },
    value: email,
  },
});

export const authErrorMessage = (error: unknown) =>
  authClientErrorMessage(error) ?? "Something went wrong. Please try again.";
