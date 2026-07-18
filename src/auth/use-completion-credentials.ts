import { startTransition, useEffect, useState } from "react";

import { parseCompletionHash } from "./completion-url";
import type { CompletionCredentials } from "./completion-url";

export const useCompletionCredentials = () => {
  const [credentials, setCredentials] = useState<CompletionCredentials>(() => ({
    challengeId: "",
  }));

  useEffect(() => {
    const parsed = parseCompletionHash(window.location.hash);
    window.history.replaceState({}, "", window.location.pathname);
    startTransition(() => setCredentials(parsed));
  }, []);

  return credentials;
};
