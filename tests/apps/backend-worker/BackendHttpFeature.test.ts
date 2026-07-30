import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import { describe, expect, it } from "vitest";

import { BackendHttpApi } from "#/apps/backend-worker/BackendHttpApi";
import { backendHttpFeatureFor } from "#/apps/backend-worker/BackendHttpFeature";

describe("Backend HTTP feature boundary", () => {
  it.each([
    ["GET", "/auth/session", "session"],
    ["POST", "/auth/magic-link/start", "magicLinkStart"],
    ["POST", "/auth/magic-link/verify", "magicLinkVerify"],
    ["GET", "/auth/step-up/options", "stepUpOptions"],
    ["POST", "/auth/first-owner/password", "accountSecurity"],
    ["POST", "/auth/step-up/password/verify", "accountSecurity"],
    ["POST", "/auth/passkey/register/start", "accountSecurity"],
    ["POST", "/auth/recovery-codes/generate", "accountSecurity"],
    ["GET", "/api/health", "health"],
    ["POST", "/api/mailboxes/bootstrap-owner", "mailbox"],
    ["GET", "/api/mailboxes/current/navigation", "mailbox"],
    ["GET", "/api/mailboxes/primary/messages", "mailbox"],
    ["POST", "/api/organizations/org-a/suspend", "organization"],
  ] as const)("routes %s %s to %s", (method, pathname, expected) => {
    expect(backendHttpFeatureFor(method, pathname)).toBe(expected);
  });

  it("returns no aggregate fallback for unknown routes", () => {
    expect(backendHttpFeatureFor("GET", "/unknown")).toBeUndefined();
    expect(backendHttpFeatureFor("GET", "/api/unknown")).toBeUndefined();
  });

  it("assigns every declared Backend endpoint to a bounded context", () => {
    const routes: { readonly method: string; readonly path: string }[] = [];
    HttpApi.reflect(BackendHttpApi, {
      onEndpoint: ({ endpoint }) => {
        routes.push({ method: endpoint.method, path: endpoint.path });
      },
      onGroup: () => void 0,
    });

    expect(routes.length).toBeGreaterThan(40);
    for (const route of routes) {
      expect(
        backendHttpFeatureFor(route.method, route.path),
        `${route.method} ${route.path}`
      ).toBeDefined();
    }
  });
});
