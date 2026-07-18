import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  authSessionQueryKey,
  clearCachedAuthSession,
  toAuthSessionQueryData,
} from "./client";

describe("auth session query cache", () => {
  it("stores unauthenticated state as successful null data", async () => {
    const queryClient = new QueryClient();
    const missingSession: { readonly userId: string } | undefined = undefined;
    queryClient.setQueryData(authSessionQueryKey, { userId: "stale-user" });

    const result = await queryClient.fetchQuery({
      queryKey: authSessionQueryKey,
      queryFn: () => Promise.resolve(toAuthSessionQueryData(missingSession)),
    });

    expect(result).toBeNull();
    expect(queryClient.getQueryState(authSessionQueryKey)?.status).toBe(
      "success"
    );
    expect(queryClient.getQueryData(authSessionQueryKey)).toBeNull();
  });

  it("removes the cached session immediately after logout", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(authSessionQueryKey, { userId: "user-a" });

    await clearCachedAuthSession(queryClient);

    expect(queryClient.getQueryData(authSessionQueryKey)).toBeNull();
  });
});
