// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useCompletionCredentials } from "./use-completion-credentials";

describe(useCompletionCredentials, () => {
  it("captures credentials after hydration and removes them from the address bar", async () => {
    window.history.replaceState(
      {},
      "",
      "/auth-complete/magic-link#challengeId=challenge-a&secret=secret-a"
    );

    const { result } = renderHook(() => useCompletionCredentials());

    await waitFor(() =>
      expect(result.current).toStrictEqual({
        challengeId: "challenge-a",
        secret: "secret-a",
      })
    );
    expect(window.location.pathname).toBe("/auth-complete/magic-link");
    expect(window.location.hash).toBe("");
  });
});
