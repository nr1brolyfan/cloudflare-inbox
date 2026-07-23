import {
  authClientErrorMessage,
  createAuthClient,
  defineAuthHttpApiExtension,
} from "@effect-auth/core/Client";
import type { AuthClientRequestOptions } from "@effect-auth/core/Client";
import { createPasskeyCredential } from "@effect-auth/core/PasskeyBrowser";
import type { QueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";

import { ApplicationAuthClientExtensionApi } from "#/modules/account-security/adapters/http/AccountSecurityClientHttpApi";
import {
  EnrollExternalRecoveryIdentityCommand,
  ReadExternalRecoveryIdentityOperationQuery,
  VerifyExternalRecoveryIdentityCommand,
} from "#/modules/account-security/application/ExternalRecoveryIdentityManagement";
import {
  ReadPasskeyRevocationQuery,
  RevokePasskeyCredentialCommand,
} from "#/modules/account-security/application/PasskeyCredentialAdministration";
import {
  FinishPasskeyEnrollmentCommand,
  StartPasskeyEnrollmentCommand,
} from "#/modules/account-security/application/PasskeyEnrollment";
import {
  GenerateRecoveryCodesCommand,
  ReadRecoveryCodeRotationQuery,
} from "#/modules/account-security/application/RecoveryCodeAdministration";
import {
  CompleteAccountRecoveryCommand,
  ReadAccountRecoveryCompletionCommand,
  StartAccountRecoveryCommand,
} from "#/modules/account-security/domain/AccountRecovery";

const applicationAuthExtension = defineAuthHttpApiExtension(
  ApplicationAuthClientExtensionApi,
  ({ run }) => ({
    completeAccountRecovery: (
      payload: Schema.Codec.Encoded<typeof CompleteAccountRecoveryCommand>,
      options?: AuthClientRequestOptions
    ) =>
      run(
        (client) =>
          client.accountRecovery.complete({
            payload: Schema.decodeUnknownSync(CompleteAccountRecoveryCommand)(
              payload
            ),
          }),
        options
      ),
    readAccountRecoveryCompletion: (
      payload: Schema.Codec.Encoded<
        typeof ReadAccountRecoveryCompletionCommand
      >,
      options?: AuthClientRequestOptions
    ) =>
      run(
        (client) =>
          client.accountRecovery.readCompletion({
            payload: Schema.decodeUnknownSync(
              ReadAccountRecoveryCompletionCommand
            )(payload),
          }),
        options
      ),
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
    readExternalRecoveryIdentityOperation: (
      query: Schema.Codec.Encoded<
        typeof ReadExternalRecoveryIdentityOperationQuery
      >,
      options?: AuthClientRequestOptions
    ) =>
      run(
        (client) =>
          client.externalRecoveryIdentity.readOperation({
            params: Schema.decodeUnknownSync(
              ReadExternalRecoveryIdentityOperationQuery
            )(query),
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
    generateRecoveryCodes: (
      payload: Schema.Codec.Encoded<typeof GenerateRecoveryCodesCommand>,
      options?: AuthClientRequestOptions
    ) =>
      run(
        (client) =>
          client.recoveryCodeManagement.generate({
            payload: Schema.decodeUnknownSync(GenerateRecoveryCodesCommand)(
              payload
            ),
          }),
        options
      ),
    readRecoveryCodeRotation: (
      query: Schema.Codec.Encoded<typeof ReadRecoveryCodeRotationQuery>,
      options?: AuthClientRequestOptions
    ) =>
      run(
        (client) =>
          client.recoveryCodeManagement.readOperation({
            params: Schema.decodeUnknownSync(ReadRecoveryCodeRotationQuery)(
              query
            ),
          }),
        options
      ),
    startAccountRecovery: (
      payload: Schema.Codec.Encoded<typeof StartAccountRecoveryCommand>,
      options?: AuthClientRequestOptions
    ) =>
      run(
        (client) =>
          client.accountRecovery.start({
            payload: Schema.decodeUnknownSync(StartAccountRecoveryCommand)(
              payload
            ),
          }),
        options
      ),
    startRecoveryPasskeyEnrollment: (options?: AuthClientRequestOptions) =>
      run(
        (client) =>
          client.recoveryPasskeyEnrollment.start({
            payload: Schema.decodeUnknownSync(StartPasskeyEnrollmentCommand)(
              {}
            ),
          }),
        options
      ),
    finishRecoveryPasskeyEnrollment: (
      payload: Schema.Codec.Encoded<typeof FinishPasskeyEnrollmentCommand>,
      options?: AuthClientRequestOptions
    ) =>
      run(
        (client) =>
          client.recoveryPasskeyEnrollment.finish({
            payload: Schema.decodeUnknownSync(FinishPasskeyEnrollmentCommand)(
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

export const generateAccountRecoveryReadbackSecret = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const binary = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join(
    ""
  );
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

export const enrollRecoveryPasskey = async () => {
  const started = await authClient.extensions.startRecoveryPasskeyEnrollment();
  const credential = await createPasskeyCredential(
    started.publicKey as Parameters<typeof createPasskeyCredential>[0]
  );
  return authClient.extensions.finishRecoveryPasskeyEnrollment({
    challengeId: started.challengeId,
    credential,
  });
};

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
