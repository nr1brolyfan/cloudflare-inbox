export interface CompletionCredentials {
  readonly challengeId: string;
  readonly secret?: string;
}

export const makeCompletionUrl = (
  publicOrigin: string,
  path: string,
  credentials: CompletionCredentials
) => {
  const url = new URL(path, publicOrigin);
  const fragment = new URLSearchParams({
    challengeId: credentials.challengeId,
  });

  if (credentials.secret !== undefined) {
    fragment.set("secret", credentials.secret);
  }

  url.hash = fragment.toString();
  return url.toString();
};

export const parseCompletionHash = (hash: string): CompletionCredentials => {
  const fragment = new URLSearchParams(
    hash.startsWith("#") ? hash.slice(1) : hash
  );
  const challengeId = fragment.get("challengeId") ?? "";
  const secret = fragment.get("secret");

  return secret === null ? { challengeId } : { challengeId, secret };
};
