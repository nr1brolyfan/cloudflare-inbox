import {
  authClientErrorMessage,
  createAuthClient,
  defineAuthHttpApiExtension,
} from "@effect-auth/core/Client";
import type { AuthClientRequestOptions } from "@effect-auth/core/Client";
import type { QueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";

import { ExternalRecoveryIdentityClientHttpApi } from "../http/external-recovery-identity-contract";
import {
  EnrollExternalRecoveryIdentityCommand,
  VerifyExternalRecoveryIdentityCommand,
} from "./external-recovery-identity-management";

const externalRecoveryIdentityExtension = defineAuthHttpApiExtension(
  ExternalRecoveryIdentityClientHttpApi,
  ({ run }) => ({
    enrollExternalRecoveryIdentity: (
      payload: Schema.Codec.Encoded<
        typeof EnrollExternalRecoveryIdentityCommand
      >,
      options?: AuthClientRequestOptions
    ) =>
      run(
        (client) =>
          client.externalRecoveryIdentity.enroll({
            payload: Schema.decodeUnknownSync(
              EnrollExternalRecoveryIdentityCommand
            )(payload),
          }),
        options
      ),
    verifyExternalRecoveryIdentity: (
      payload: Schema.Codec.Encoded<
        typeof VerifyExternalRecoveryIdentityCommand
      >,
      options?: AuthClientRequestOptions
    ) =>
      run(
        (client) =>
          client.externalRecoveryIdentity.verify({
            payload: Schema.decodeUnknownSync(
              VerifyExternalRecoveryIdentityCommand
            )(payload),
          }),
        options
      ),
  })
);

export const authClient = createAuthClient({
  protocol: { extensions: externalRecoveryIdentityExtension },
});

export const authSessionQueryKey = ["auth", "session"] as const;
export const mailboxReadDenialQueryKey = ["mailbox-access-denial"] as const;

export const toAuthSessionQueryData = <A>(session: A | undefined): A | null =>
  session ?? null;

export const currentSessionForQuery = async (signal?: AbortSignal) =>
  toAuthSessionQueryData(
    await authClient.session.currentOrUndefined({ signal })
  );

export const clearCachedMailboxData = (queryClient: QueryClient) => {
  queryClient.removeQueries({ queryKey: ["mailbox"] });
};

export const clearCachedAuthSession = async (queryClient: QueryClient) => {
  clearCachedMailboxData(queryClient);
  queryClient.removeQueries({ queryKey: mailboxReadDenialQueryKey });
  queryClient.setQueryData(authSessionQueryKey, null);
  await queryClient.invalidateQueries({ queryKey: authSessionQueryKey });
};

/** Purges protected browser state immediately after an authoritative read denial. */
export const handleMailboxReadDenial = async (
  queryClient: QueryClient,
  result: { readonly ok: boolean; readonly status?: number }
) => {
  if (result.ok) {
    return;
  }
  if (result.status === 401) {
    await clearCachedAuthSession(queryClient);
  } else if (result.status === 403) {
    queryClient.setQueryData(mailboxReadDenialQueryKey, { status: 403 });
    clearCachedMailboxData(queryClient);
  }
};

export const clearMailboxReadDenial = (queryClient: QueryClient) => {
  queryClient.removeQueries({ queryKey: mailboxReadDenialQueryKey });
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
