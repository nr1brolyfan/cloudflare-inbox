// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SignedInOwnerBootstrap } from "#/routes/-index-owner-bootstrap";

const mocks = vi.hoisted(() => ({
  bootstrapMailboxOwner: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  enrollFirstOwnerPassword: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
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
const password = "correct horse battery staple";

const renderBootstrap = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <SignedInOwnerBootstrap
        isLogoutPending={false}
        onLogout={vi.fn<() => void>()}
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

  it("requires operator acknowledgement and creates only after one explicit final click", async () => {
    mocks.stepUpOptions.mockResolvedValue({ factors: [{ type: "password" }] });
    renderBootstrap();
    fireEvent.click(screen.getByRole("button", { name: "Begin secure setup" }));
    fireEvent.change(await screen.findByLabelText("Password"), {
      target: { value: password },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm with password" })
    );
    const create = await screen.findByRole("button", {
      name: "Create primary inbox",
    });
    const acknowledgement = screen.getByLabelText(
      /I confirm that the external recovery address is verified/u
    );

    expect(mocks.bootstrapMailboxOwner).not.toHaveBeenCalled();
    expect((create as HTMLButtonElement).disabled).toBeTruthy();
    fireEvent.click(create);
    expect(mocks.bootstrapMailboxOwner).not.toHaveBeenCalled();
    fireEvent.click(acknowledgement);
    expect((create as HTMLButtonElement).disabled).toBeFalsy();
    fireEvent.click(create);
    await waitFor(() =>
      expect(mocks.bootstrapMailboxOwner).toHaveBeenCalledOnce()
    );
  });
});
