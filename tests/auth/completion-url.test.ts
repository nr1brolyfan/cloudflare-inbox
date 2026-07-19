import { describe, expect, it } from "vitest";

import { completionUrl, parseCompletionHash } from "#/auth/completion-url";

describe("completion URLs", () => {
  it("keeps authentication credentials out of the request URL", () => {
    const url = completionUrl(
      "https://inbox.example.com",
      "/auth-complete/magic-link",
      {
        challengeId: "challenge-a",
        secret: "secret-a",
      }
    );
    const parsed = new URL(url);

    expect(parsed.pathname).toBe("/auth-complete/magic-link");
    expect(parsed.search).toBe("");
    expect(parsed.hash).toBe("#challengeId=challenge-a&secret=secret-a");
  });

  it("round-trips credentials through the URL fragment", () => {
    expect(
      parseCompletionHash(
        "#challengeId=challenge%2Fwith%2Fslashes&secret=a%26b"
      )
    ).toStrictEqual({
      challengeId: "challenge/with/slashes",
      secret: "a&b",
    });
  });

  it("supports challenge-only verification links", () => {
    expect(parseCompletionHash("#challengeId=challenge-a")).toStrictEqual({
      challengeId: "challenge-a",
    });
  });
});
