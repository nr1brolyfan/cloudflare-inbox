import { describe, expect, it } from "vitest";

import { backendHttpApplicationKind } from "#/apps/backend-worker/BackendHttpApplicationSelection";

describe(backendHttpApplicationKind, () => {
  it.each([
    ["GET", "/api/health", "health"],
    ["GET", "/auth/session", "session"],
    ["POST", "/auth/magic-link/start", "magic-link-start"],
    ["POST", "/auth/session", "aggregate"],
    ["GET", "/auth/magic-link/start", "aggregate"],
    ["GET", "/api/mailboxes/primary/navigation", "aggregate"],
  ] as const)("selects %s %s as %s", (method, pathname, expected) => {
    expect(backendHttpApplicationKind(method, pathname)).toBe(expected);
  });
});
