import { QueryClient, QueryObserver } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  authSessionQueryKey,
  clearCachedAuthSession,
  clearCachedMailboxData,
  clearMailboxReadDenial,
  freshPasskeyEnrollmentOperationId,
  generateAccountRecoveryReadbackSecret,
  handleMailboxReadDenial,
  mailboxReadDenialQueryKey,
  runPasskeyBrowserCeremony,
  runRecoveryPasskeyBrowserCeremony,
  toAuthSessionQueryData,
} from "#/modules/account-security/adapters/browser/AuthClient";
import { AccountRecoveryReadbackSecret } from "#/modules/account-security/domain/AccountRecovery";

const operationId = "00000000-0000-4000-8000-000000000081";
const readbackSecret = "r".repeat(43);

describe("application-owned passkey browser ceremonies", () => {
  it("rotates the normal operation only after success", () => {
    const generated = [operationId, operationId, "next-operation-id"];
    const randomId = () => generated.shift() ?? "unexpected-operation-id";

    const retainedAcrossRetry = operationId;
    const afterSuccess = freshPasskeyEnrollmentOperationId(
      retainedAcrossRetry,
      randomId
    );

    expect(retainedAcrossRetry).toBe(operationId);
    expect(afterSuccess).toBe("next-operation-id");
  });

  it("forwards one caller operation ID through normal start and finish", async () => {
    const calls: unknown[] = [];
    const result = await runPasskeyBrowserCeremony(operationId, {
      createCredential: (publicKey) => {
        calls.push({ publicKey });
        return Promise.resolve({ id: "browser-credential-a" });
      },
      finish: (input) => {
        calls.push({ finish: input });
        return Promise.resolve({ credentialRecordId: "record-a" });
      },
      read: (input) => {
        calls.push({ read: input });
        return Promise.resolve({ credentialRecordId: "record-a" });
      },
      start: (input) => {
        calls.push({ start: input });
        return Promise.resolve({
          challengeId: "challenge-a",
          publicKey: { challenge: "a" },
        });
      },
    });

    expect(result).toStrictEqual({ credentialRecordId: "record-a" });
    expect(calls).toStrictEqual([
      { start: { operationId } },
      { publicKey: { challenge: "a" } },
      {
        finish: {
          challengeId: "challenge-a",
          credential: { id: "browser-credential-a" },
          operationId,
        },
      },
    ]);
  });

  it.each([
    "bad_request",
    "conflict",
    "policy_denied",
    "rate_limited",
    "step_up_required",
    "unauthenticated",
  ])(
    "does not read a receipt after definitive %s finish failure",
    async (code) => {
      let reads = 0;
      const failure = Object.assign(new Error("definitive finish failure"), {
        code,
      });

      await expect(
        runPasskeyBrowserCeremony(operationId, {
          createCredential: () =>
            Promise.resolve({ id: "browser-credential-a" }),
          finish: () => Promise.reject(failure),
          read: () => {
            reads += 1;
            return Promise.resolve({ credentialRecordId: "record-a" });
          },
          start: () =>
            Promise.resolve({ challengeId: "challenge-a", publicKey: {} }),
        })
      ).rejects.toBe(failure);
      expect(reads).toBe(0);
    }
  );

  it("reads the normal receipt after an ambiguous internal finish failure", async () => {
    let reads = 0;
    const receipt = { credentialRecordId: "record-a", operationId };

    await expect(
      runPasskeyBrowserCeremony(operationId, {
        createCredential: () => Promise.resolve({ id: "browser-credential-a" }),
        finish: () =>
          Promise.reject(
            Object.assign(new Error("outcome unknown"), {
              code: "internal_error",
            })
          ),
        read: () => {
          reads += 1;
          return Promise.resolve(receipt);
        },
        start: () =>
          Promise.resolve({ challengeId: "challenge-a", publicKey: {} }),
      })
    ).resolves.toBe(receipt);
    expect(reads).toBe(1);
  });

  it("does not turn an ambiguous normal changed-intent failure into success", async () => {
    const originalCredential = { id: "browser-credential-original" };
    const changedCredential = { id: "browser-credential-changed" };
    const failure = Object.assign(new Error("outcome unknown"), {
      code: "internal_error",
    });

    await expect(
      runPasskeyBrowserCeremony(operationId, {
        createCredential: () => Promise.resolve(changedCredential),
        finish: () => Promise.reject(failure),
        read: ({ challengeId, credential }) =>
          credential === originalCredential && challengeId === "challenge-a"
            ? Promise.resolve({ operationId })
            : Promise.reject(new Error("receipt intent mismatch")),
        start: () =>
          Promise.resolve({ challengeId: "challenge-a", publicKey: {} }),
      })
    ).rejects.toBe(failure);
  });

  it("forwards one recovery operation and proof secret, then reads receipt only after ambiguity", async () => {
    const calls: unknown[] = [];
    const result = await runRecoveryPasskeyBrowserCeremony(
      operationId,
      readbackSecret,
      {
        createCredential: () => Promise.resolve({ id: "browser-credential-a" }),
        finish: (input) => {
          calls.push({ finish: input });
          return Promise.reject(new Error("response lost"));
        },
        read: (input) => {
          calls.push({ read: input });
          return Promise.resolve({ operationId });
        },
        start: (input) => {
          calls.push({ start: input });
          return Promise.resolve({ challengeId: "challenge-a", publicKey: {} });
        },
      }
    );

    expect(result).toStrictEqual({
      receipt: { operationId },
      type: "recovery-remediation-committed-without-one-time-material",
    });
    expect(calls).toStrictEqual([
      { start: { operationId, readbackSecret } },
      {
        finish: {
          challengeId: "challenge-a",
          credential: { id: "browser-credential-a" },
          operationId,
          readbackSecret,
        },
      },
      {
        read: {
          challengeId: "challenge-a",
          credential: { id: "browser-credential-a" },
          operationId,
          readbackSecret,
        },
      },
    ]);
  });

  it("does not turn an ambiguous recovery changed-intent failure into success", async () => {
    const originalCredential = { id: "browser-credential-original" };
    const changedCredential = { id: "browser-credential-changed" };
    const failure = new Error("response lost");

    await expect(
      runRecoveryPasskeyBrowserCeremony(operationId, readbackSecret, {
        createCredential: () => Promise.resolve(changedCredential),
        finish: () => Promise.reject(failure),
        read: ({ challengeId, credential }) =>
          credential === originalCredential && challengeId === "challenge-a"
            ? Promise.resolve({ operationId })
            : Promise.reject(new Error("receipt proof mismatch")),
        start: () =>
          Promise.resolve({ challengeId: "challenge-a", publicKey: {} }),
      })
    ).rejects.toBe(failure);
  });

  it("does not read recovery receipts after definitive finish failures", async () => {
    let reads = 0;
    const failure = Object.assign(new Error("invalid registration"), {
      code: "bad_request",
    });

    await expect(
      runRecoveryPasskeyBrowserCeremony(operationId, readbackSecret, {
        createCredential: () => Promise.resolve({ id: "credential-a" }),
        finish: () => Promise.reject(failure),
        read: () => {
          reads += 1;
          return Promise.resolve({ operationId });
        },
        start: () =>
          Promise.resolve({ challengeId: "challenge-a", publicKey: {} }),
      })
    ).rejects.toBe(failure);
    expect(reads).toBe(0);
  });
});

describe("account recovery browser proof", () => {
  it("generates a fresh canonical 256-bit readback secret", () => {
    const first = generateAccountRecoveryReadbackSecret();
    const second = generateAccountRecoveryReadbackSecret();

    expect(() =>
      Schema.decodeUnknownSync(AccountRecoveryReadbackSecret)(first)
    ).not.toThrow();
    expect(first).toHaveLength(43);
    expect(second).toHaveLength(43);
    expect(first).not.toBe(second);
  });
});

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
    queryClient.setQueryData(["mailbox", "navigation", "user-a"], {
      mailbox: "sensitive cached data",
    });
    queryClient.setQueryData(["auth", "passkey-credentials", "user-a"], {
      credentials: [{ id: "passkey-a" }],
    });

    await clearCachedAuthSession(queryClient);

    expect({
      mailbox: queryClient.getQueryData(["mailbox", "navigation", "user-a"]),
      passkeys: queryClient.getQueryData([
        "auth",
        "passkey-credentials",
        "user-a",
      ]),
      session: queryClient.getQueryData(authSessionQueryKey),
    }).toStrictEqual({
      mailbox: undefined,
      passkeys: undefined,
      session: null,
    });
  });

  it("clears mailbox data without ending a valid session", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(authSessionQueryKey, { userId: "user-a" });
    queryClient.setQueryData(["mailbox", "thread", "message-1"], {
      body: "sensitive cached body",
    });

    clearCachedMailboxData(queryClient);

    expect({
      mailbox: queryClient.getQueryData(["mailbox", "thread", "message-1"]),
      session: queryClient.getQueryData(authSessionQueryKey),
    }).toStrictEqual({ mailbox: undefined, session: { userId: "user-a" } });
  });

  it("purges mailbox and session cache after an unauthenticated read", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(authSessionQueryKey, { userId: "user-a" });
    queryClient.setQueryData(["mailbox", "messages"], ["private subject"]);

    await handleMailboxReadDenial(queryClient, { ok: false, status: 401 });

    expect({
      mailbox: queryClient.getQueryData(["mailbox", "messages"]),
      session: queryClient.getQueryData(authSessionQueryKey),
    }).toStrictEqual({ mailbox: undefined, session: null });
  });

  it("purges mailbox data but keeps the session after a forbidden read", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(authSessionQueryKey, { userId: "user-a" });
    queryClient.setQueryData(["mailbox", "messages"], ["private subject"]);

    await handleMailboxReadDenial(queryClient, { ok: false, status: 403 });

    expect({
      denial: queryClient.getQueryData(mailboxReadDenialQueryKey),
      mailbox: queryClient.getQueryData(["mailbox", "messages"]),
      session: queryClient.getQueryData(authSessionQueryKey),
    }).toStrictEqual({
      denial: { status: 403 },
      mailbox: undefined,
      session: { userId: "user-a" },
    });

    clearMailboxReadDenial(queryClient);
    expect(queryClient.getQueryData(mailboxReadDenialQueryKey)).toBeUndefined();
  });

  it("publishes forbidden state to active observers before protected UI can render", async () => {
    const queryClient = new QueryClient();
    const observer = new QueryObserver(queryClient, {
      enabled: false,
      queryKey: mailboxReadDenialQueryKey,
    });
    let denial: unknown;
    const unsubscribe = observer.subscribe((result) => {
      denial = result.data;
    });

    await handleMailboxReadDenial(queryClient, { ok: false, status: 403 });

    expect(denial).toStrictEqual({ status: 403 });
    unsubscribe();
  });
});
