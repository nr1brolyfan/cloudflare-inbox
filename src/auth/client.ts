import {
  authClientErrorMessage,
  createAuthClient,
  defineAuthHttpApiExtension,
} from "@effect-auth/core/Client";
import type { AuthClientRequestOptions } from "@effect-auth/core/Client";
import type { QueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";

import { ApplicationAuthClientExtensionApi } from "../http/auth-client-extension-contract";
import {
  EnrollExternalRecoveryIdentityCommand,
  VerifyExternalRecoveryIdentityCommand,
} from "./external-recovery-identity-management";
import {
  ReadPasskeyRevocationQuery,
  RevokePasskeyCredentialCommand,
} from "./passkey-credential-administration";

const applicationAuthExtension = defineAuthHttpApiExtension(
  ApplicationAuthClientExtensionApi,
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
    listPasskeyCredentials: (options?: AuthClientRequestOptions) =>
      run(
        (client) => client.passkeyCredentialManagement.list({ payload: {} }),
        options
      ),
    readPasskeyRevocation: (
      query: Schema.Codec.Encoded<typeof ReadPasskeyRevocationQuery>,
      options?: AuthClientRequestOptions
    ) =>
      run(
        (client) =>
          client.passkeyCredentialManagement.readRevocation({
            payload: Schema.decodeUnknownSync(ReadPasskeyRevocationQuery)(
              query
            ),
          }),
        options
      ),
    revokePasskeyCredential: (
      payload: Schema.Codec.Encoded<typeof RevokePasskeyCredentialCommand>,
      options?: AuthClientRequestOptions
    ) =>
      run(
        (client) =>
          client.passkeyCredentialManagement.revoke({
            payload: Schema.decodeUnknownSync(RevokePasskeyCredentialCommand)(
              payload
            ),
          }),
        options
      ),
  })
);

export const authClient = createAuthClient({
  protocol: { extensions: applicationAuthExtension },
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
  queryClient.removeQueries({ queryKey: ["auth", "passkey-credentials"] });
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
