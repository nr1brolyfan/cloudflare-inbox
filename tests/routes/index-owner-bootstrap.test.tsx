// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SignedInOwnerBootstrap } from "#/routes/-index-owner-bootstrap";

const mocks = vi.hoisted(() => ({
  bootstrapMailboxOwner: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  enrollFirstOwnerPassword: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  generateRecoveryCodes: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  getMailboxNavigation: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  listPasskeyCredentials: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  readMailboxAdministrationOperation:
    vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  stepUpOptions: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  stepUpPassword: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock(import("#/apps/website/TanStackFunctions"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    bootstrapMailboxOwner:
      mocks.bootstrapMailboxOwner as unknown as typeof actual.bootstrapMailboxOwner,
    getMailboxNavigation:
      mocks.getMailboxNavigation as unknown as typeof actual.getMailboxNavigation,
    readMailboxAdministrationOperation:
      mocks.readMailboxAdministrationOperation as unknown as typeof actual.readMailboxAdministrationOperation,
  };
});

vi.mock(
  import("#/modules/account-security/adapters/browser/AuthClient"),
  async (importOriginal) => {
    const actual = await importOriginal();
    return {
      ...actual,
      authClient: {
        ...actual.authClient,
        extensions: {
          ...actual.authClient.extensions,
          enrollFirstOwnerPassword: mocks.enrollFirstOwnerPassword,
          generateRecoveryCodes: mocks.generateRecoveryCodes,
          listPasskeyCredentials: mocks.listPasskeyCredentials,
        },
        passkey: { ...actual.authClient.passkey, isSupported: () => false },
        stepUp: {
          ...actual.authClient.stepUp,
          options: mocks.stepUpOptions,
          passkey: {
            ...actual.authClient.stepUp.passkey,
            verify: vi.fn<typeof actual.authClient.stepUp.passkey.verify>(),
          },
          password: {
            ...actual.authClient.stepUp.password,
            verify: mocks.stepUpPassword,
          },
        },
      } as typeof actual.authClient,
      authErrorMessage: (error: unknown) =>
        error instanceof Error ? error.message : "Request failed",
      authSessionQueryKey: ["auth", "session"] as const,
      clearCachedAuthSession: vi.fn<typeof actual.clearCachedAuthSession>(),
      enrollPasskey: vi.fn<typeof actual.enrollPasskey>(),
      freshPasskeyEnrollmentOperationId: () => "passkey-operation",
    };
  }
);

const stepUpRequired = {
  error: { code: "step_up_required", message: "Step-up required" },
  ok: false,
  status: 403,
};
const mailboxNotFound = {
  error: { code: "not_found", message: "Not found" },
  ok: false,
  status: 404,
};
const password = "correct horse battery staple";

const renderBootstrap = (
  onLogout = vi.fn<() => void>(),
  onMailboxFound = vi.fn<() => void>(),
  initialNavigation: unknown | null = mailboxNotFound
) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  if (initialNavigation !== null) {
    queryClient.setQueryDefaults(
      ["mailbox", "navigation", "user-a", "session-a"],
      { staleTime: Number.POSITIVE_INFINITY }
    );
    queryClient.setQueryData(
      ["mailbox", "navigation", "user-a", "session-a"],
      initialNavigation
    );
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <SignedInOwnerBootstrap
        isLogoutPending={false}
        onMailboxFound={onMailboxFound}
        onLogout={onLogout}
        sessionId="session-a"
        userId="user-a"
      />
    </QueryClientProvider>
  );
};

const openFirstPasswordPanel = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Begin secure setup" }));
  await screen.findByRole("heading", { name: "Create your first password" });
};

const submitFirstPassword = (confirmation = password) => {
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: confirmation },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Create password and confirm" })
  );
};

const openMailboxCreation = async () => {
  mocks.stepUpOptions.mockResolvedValue({ factors: [{ type: "password" }] });
  renderBootstrap();
  fireEvent.click(screen.getByRole("button", { name: "Begin secure setup" }));
  fireEvent.change(await screen.findByLabelText("Password"), {
    target: { value: password },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm with password" })
  );
  return screen.findByRole("button", { name: "Create primary inbox" });
};

const generatedCodes = (operationId: string) => ({
  _tag: "RecoveryCodesGenerated",
  codes: Array.from({ length: 10 }, (_, index) => `CODE-CODE-CODE-COD${index}`),
  receipt: {
    codeCount: 10,
    committedAt: 2000,
    generatedAt: 2000,
    operationId,
    schemaVersion: 1,
    setId: "00000000-0000-4000-8000-000000000201",
    userId: "user-a",
  },
});

describe(SignedInOwnerBootstrap, () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
    mocks.bootstrapMailboxOwner.mockResolvedValue(stepUpRequired);
    mocks.enrollFirstOwnerPassword.mockResolvedValue({
      _tag: "FirstOwnerPasswordEnrolled",
      receipt: {
        committedAt: 2000,
        operationId: "password-operation",
        schemaVersion: 1,
      },
    });
    mocks.listPasskeyCredentials.mockResolvedValue({ credentials: [] });
    mocks.generateRecoveryCodes.mockImplementation((command) => {
      const { operationId } = command as { operationId: string };
      return Promise.resolve(generatedCodes(operationId));
    });
    mocks.getMailboxNavigation.mockResolvedValue(mailboxNotFound);
    mocks.readMailboxAdministrationOperation.mockResolvedValue({
      error: { code: "not_found", message: "Not found" },
      ok: false,
      status: 404,
    });
    mocks.stepUpOptions.mockResolvedValue({ factors: [] });
    mocks.stepUpPassword.mockResolvedValue({});
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000101")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000102")
      .mockReturnValue("00000000-0000-4000-8000-000000000103");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens an existing mailbox without showing onboarding", async () => {
    const onMailboxFound = vi.fn<() => void>();
    mocks.getMailboxNavigation.mockResolvedValue({
      mailbox: { displayName: "Inbox", id: "primary" },
      ok: true,
    });

    renderBootstrap(vi.fn(), onMailboxFound, null);

    await waitFor(() => expect(onMailboxFound).toHaveBeenCalledOnce());
    expect(
      screen.queryByRole("button", { name: "Begin secure setup" })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Create primary inbox" })
    ).toBeNull();
    expect(screen.queryByText(/Recovery addresses, passkeys/u)).toBeNull();
  });

  it("does not show onboarding when mailbox discovery fails", async () => {
    mocks.getMailboxNavigation.mockResolvedValue({
      error: { code: "service_unavailable", message: "Unavailable" },
      ok: false,
      status: 503,
    });

    renderBootstrap(vi.fn(), vi.fn(), null);

    await screen.findByText(/could not check whether your primary inbox/u);
    expect(
      screen.queryByRole("button", { name: "Create primary inbox" })
    ).toBeNull();
  });

  it("requires a fresh email sign-in after first-owner proof expires", async () => {
    const onLogout = vi.fn<() => void>();
    mocks.stepUpOptions.mockResolvedValue({ factors: [] });
    mocks.enrollFirstOwnerPassword.mockRejectedValue(
      Object.assign(new Error("First-owner password enrollment denied"), {
        code: "step_up_required",
      })
    );
    renderBootstrap(onLogout);
    await openFirstPasswordPanel();

    submitFirstPassword();

    await expect(
      screen.findByText(/email proof has expired/u)
    ).resolves.toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Sign out and use a fresh link" })
    );
    expect(onLogout).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "Create password and confirm" })
    ).toBeNull();
  });

  it("steps up immediately after enrollment without creating the mailbox", async () => {
    renderBootstrap();
    await openFirstPasswordPanel();
    submitFirstPassword();

    await waitFor(() => {
      expect(mocks.stepUpPassword).toHaveBeenCalledWith({ password });
    });
    expect(mocks.enrollFirstOwnerPassword).toHaveBeenCalledOnce();
    expect(mocks.bootstrapMailboxOwner).not.toHaveBeenCalled();
    await expect(
      screen.findByRole("heading", { name: "External recovery address" })
    ).resolves.toBeTruthy();
  });

  it("uses ordinary password step-up after enrollment commits and immediate step-up fails", async () => {
    mocks.stepUpPassword
      .mockRejectedValueOnce(new Error("Immediate step-up failed"))
      .mockResolvedValueOnce({});
    mocks.stepUpOptions
      .mockResolvedValueOnce({ factors: [] })
      .mockResolvedValue({ factors: [{ type: "password" }] });
    renderBootstrap();
    await openFirstPasswordPanel();
    submitFirstPassword();

    await screen.findByText("Confirm this ownership action");
    fireEvent.change(await screen.findByLabelText("Password"), {
      target: { value: password },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm with password" })
    );
    await waitFor(() => expect(mocks.stepUpPassword).toHaveBeenCalledTimes(2));
    expect(mocks.enrollFirstOwnerPassword).toHaveBeenCalledOnce();
  });

  it("does not send enrollment or step-up when confirmation differs", async () => {
    renderBootstrap();
    await openFirstPasswordPanel();
    submitFirstPassword("different password value");

    await screen.findByText("Passwords do not match");
    expect(mocks.enrollFirstOwnerPassword).not.toHaveBeenCalled();
    expect(mocks.stepUpPassword).not.toHaveBeenCalled();
    expect(
      (screen.getByLabelText("New password") as HTMLInputElement).value
    ).toBe("");
    expect(
      (screen.getByLabelText("Confirm password") as HTMLInputElement).value
    ).toBe("");
  });

  it("preserves the enrollment operation ID across enrollment retries", async () => {
    mocks.enrollFirstOwnerPassword.mockRejectedValue(
      new Error("Enrollment unavailable")
    );
    renderBootstrap();
    await openFirstPasswordPanel();
    submitFirstPassword();
    await screen.findByText("Enrollment unavailable");
    submitFirstPassword();
    await waitFor(() =>
      expect(mocks.enrollFirstOwnerPassword).toHaveBeenCalledTimes(2)
    );

    expect(
      mocks.enrollFirstOwnerPassword.mock.calls.map(([command]) => command)
    ).toStrictEqual([
      {
        operationId: "00000000-0000-4000-8000-000000000102",
        password,
      },
      {
        operationId: "00000000-0000-4000-8000-000000000102",
        password,
      },
    ]);
  });

  it("clears the ordinary owner step-up password after an error", async () => {
    mocks.stepUpPassword.mockRejectedValue(new Error("Step-up failed"));
    mocks.stepUpOptions.mockResolvedValue({ factors: [{ type: "password" }] });
    renderBootstrap();
    fireEvent.click(screen.getByRole("button", { name: "Begin secure setup" }));
    await screen.findByText("Confirm this ownership action");
    fireEvent.change(await screen.findByLabelText("Password"), {
      target: { value: password },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm with password" })
    );

    await screen.findByText("Step-up failed");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe(
      ""
    );
  });

  it("requires acknowledgement of the exact plaintext generation before one final click", async () => {
    const create = await openMailboxCreation();

    expect({
      authoritative: screen.getByText(
        /The server is authoritative for recovery/u
      ).textContent,
      createDisabled: (create as HTMLButtonElement).disabled,
      oldCheckbox: screen.queryByRole("checkbox"),
    }).toStrictEqual({
      authoritative: expect.stringContaining("server is authoritative"),
      createDisabled: true,
      oldCheckbox: null,
    });
    fireEvent.click(create);
    expect(mocks.bootstrapMailboxOwner).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Generate new recovery codes" })
    );
    const acknowledgement = await screen.findByRole("button", {
      name: "I saved these codes",
    });
    fireEvent.click(acknowledgement);
    expect((create as HTMLButtonElement).disabled).toBeFalsy();
    fireEvent.click(create);
    const acknowledgedOperationId = (
      mocks.generateRecoveryCodes.mock.calls[0]?.[0] as
        | { operationId: string }
        | undefined
    )?.operationId;
    await waitFor(() =>
      expect(mocks.bootstrapMailboxOwner).toHaveBeenCalledWith({
        data: {
          acknowledgedRecoveryCodeRotationOperationId: acknowledgedOperationId,
          displayName: "Inbox",
          operationId: "00000000-0000-4000-8000-000000000101",
        },
      })
    );
  });

  it("resets an exact acknowledgement while a replacement starts and requires the replacement acknowledgement", async () => {
    const create = await openMailboxCreation();
    fireEvent.click(
      screen.getByRole("button", { name: "Generate new recovery codes" })
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "I saved these codes" })
    );
    expect((create as HTMLButtonElement).disabled).toBeFalsy();
    const replacement = Effect.runSync(Deferred.make<unknown>());
    mocks.generateRecoveryCodes.mockReturnValueOnce(
      Effect.runPromise(Deferred.await(replacement))
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Generate replacement codes" })
    );
    expect((create as HTMLButtonElement).disabled).toBeTruthy();
    Effect.runSync(
      Deferred.succeed(
        replacement,
        generatedCodes("00000000-0000-4000-8000-000000000202")
      )
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "I saved these codes" })
    );
    expect((create as HTMLButtonElement).disabled).toBeFalsy();
  });

  it("keeps create disabled after an unknown committed receipt-only replacement", async () => {
    const create = await openMailboxCreation();
    fireEvent.click(
      screen.getByRole("button", { name: "Generate new recovery codes" })
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "I saved these codes" })
    );
    mocks.generateRecoveryCodes.mockImplementationOnce((command) =>
      Promise.resolve({
        _tag: "RecoveryCodesAlreadyGenerated",
        receipt: generatedCodes(
          (command as { operationId: string }).operationId
        ).receipt,
      })
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Generate replacement codes" })
    );
    await screen.findByText(/one-time codes cannot be recovered/u);
    expect((create as HTMLButtonElement).disabled).toBeTruthy();
    expect(mocks.bootstrapMailboxOwner).not.toHaveBeenCalled();
  });

  it("resets acknowledgement on a failed replacement retry even while old plaintext remains in memory", async () => {
    const create = await openMailboxCreation();
    fireEvent.click(
      screen.getByRole("button", { name: "Generate new recovery codes" })
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "I saved these codes" })
    );
    mocks.generateRecoveryCodes.mockRejectedValueOnce(
      new Error("Replacement unavailable")
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Generate replacement codes" })
    );
    await screen.findByText("Replacement unavailable");
    expect((create as HTMLButtonElement).disabled).toBeTruthy();
  });

  it("does not retain acknowledgement across component remount", async () => {
    const rendered = renderBootstrap();
    mocks.stepUpOptions.mockResolvedValue({ factors: [{ type: "password" }] });
    fireEvent.click(screen.getByRole("button", { name: "Begin secure setup" }));
    fireEvent.change(await screen.findByLabelText("Password"), {
      target: { value: password },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm with password" })
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Generate new recovery codes" })
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "I saved these codes" })
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Create primary inbox",
        }) as HTMLButtonElement
      ).disabled
    ).toBeFalsy();

    rendered.unmount();
    const create = await openMailboxCreation();
    expect((create as HTMLButtonElement).disabled).toBeTruthy();
  });
});
