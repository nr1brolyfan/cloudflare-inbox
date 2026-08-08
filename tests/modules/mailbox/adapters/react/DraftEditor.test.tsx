// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as Schema from "effect/Schema";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DraftEditorFields } from "#/modules/mailbox/adapters/browser/DraftSessionStorage";
import {
  DraftEditor,
  draftSendErrorText,
} from "#/modules/mailbox/adapters/react/DraftEditor";
import type { DraftEditorSnapshot } from "#/modules/mailbox/adapters/react/DraftEditor";
import { DraftEditorContent } from "#/modules/mailbox/application/MailboxDraftEditing";
import { MailAddress } from "#/shared/MailAddress";

const initial = Schema.decodeUnknownSync(DraftEditorContent)({
  bcc: [],
  cc: [{ address: "copy@example.test" }],
  subject: "Initial subject",
  textBody: "Initial body",
  to: [{ address: "person@example.test", displayName: "Person" }],
});

const renderEditor = (
  overrides: Partial<React.ComponentProps<typeof DraftEditor>> = {}
) => {
  const props: React.ComponentProps<typeof DraftEditor> = {
    attachments: [],
    attachmentUploads: [],
    initial,
    isNew: false,
    isSendUncertain: false,
    isSaving: false,
    isSending: false,
    onAttachFiles:
      vi.fn<(files: readonly File[], snapshot: DraftEditorSnapshot) => void>(),
    onAutosave: vi.fn<(snapshot: DraftEditorSnapshot) => void>(),
    onChange: vi.fn<(fields: DraftEditorFields) => void>(),
    onClose: vi.fn<(snapshot: DraftEditorSnapshot) => void>(),
    onDismissAttachmentUpload: vi.fn<(id: string) => void>(),
    onRetryAttachmentUpload: vi.fn<(id: string) => void>(),
    onSend: vi.fn<(snapshot: DraftEditorSnapshot) => void>(),
    saveStatus: "saved",
    ...overrides,
  };
  render(<DraftEditor {...props} />);
  return props;
};

describe(DraftEditor, () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("debounces valid changes and removes the manual save UI", () => {
    vi.useFakeTimers();
    const onAutosave = vi.fn<(snapshot: DraftEditorSnapshot) => void>();
    renderEditor({ onAutosave });

    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), {
      target: { value: "First" },
    });
    vi.advanceTimersByTime(500);
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), {
      target: { value: "Latest" },
    });
    vi.advanceTimersByTime(699);
    expect(onAutosave).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onAutosave).toHaveBeenCalledOnce();
    expect(onAutosave.mock.calls[0]?.[0]).toMatchObject({
      content: { subject: "Latest" },
      fields: { subject: "Latest" },
    });
  });

  it("recovers raw partial fields and keeps invalid edits out of autosave", () => {
    vi.useFakeTimers();
    const onAutosave = vi.fn<(snapshot: DraftEditorSnapshot) => void>();
    renderEditor({
      initialFields: {
        bcc: "",
        cc: "copy@example.test",
        subject: "Recovered partial subject",
        textBody: "Recovered body",
        to: "not-an-address",
      },
      onAutosave,
    });

    expect(
      (screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement)
        .value
    ).toBe("Recovered body");
    vi.advanceTimersByTime(700);
    expect(onAutosave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByRole("alert").textContent).toContain(
      "Check the recipient addresses"
    );
  });

  it("sends a new dirty draft using the latest parsed fields", () => {
    const onSend = vi.fn<(snapshot: DraftEditorSnapshot) => void>();
    renderEditor({ isNew: true, onSend, saveStatus: "unsaved" });
    fireEvent.change(screen.getByRole("combobox", { name: "To recipients" }), {
      target: { value: "Next <next@example.test>" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Latest unsaved body" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          textBody: "Latest unsaved body",
          to: [{ address: "next@example.test", displayName: "Next" }],
        }),
      })
    );
  });

  it("loads recipient suggestions and selects them without submitting", async () => {
    vi.useFakeTimers();
    const onSend = vi.fn<(snapshot: DraftEditorSnapshot) => void>();
    const alice = Schema.decodeUnknownSync(MailAddress)({
      address: "alice@example.test",
      displayName: "Alice",
    });
    const loadRecipientSuggestions = vi.fn<
      (query: string) => Promise<readonly (typeof initial.to)[number][]>
    >(() => Promise.resolve([alice]));
    renderEditor({ loadRecipientSuggestions, onSend });
    const input = screen.getByRole("combobox", { name: "To recipients" });

    fireEvent.change(input, { target: { value: "al" } });
    await act(() => vi.advanceTimersByTimeAsync(120));

    expect(loadRecipientSuggestions).toHaveBeenCalledWith("al");
    expect(screen.getByRole("option", { name: /Alice/u })).toBeDefined();
    fireEvent.keyDown(input, { key: "Enter" });
    expect((input as HTMLInputElement).value).toBe(
      "Alice <alice@example.test>, "
    );
    expect(onSend).not.toHaveBeenCalled();
  });

  it("stays editable during background saving and reports save status", () => {
    renderEditor({ isSaving: true, saveStatus: "saving" });
    const subject = screen.getByRole("textbox", { name: "Subject" });
    expect(subject.hasAttribute("disabled")).toBeFalsy();
    expect(screen.getByText("Saving...")).toBeDefined();
    expect(
      screen.getByText("You can keep editing while this draft is saved.")
    ).toBeDefined();
  });

  it("keeps local content editable after a save error and exposes exact retry", () => {
    const onRetry = vi.fn<() => void>();
    renderEditor({
      error: "The draft could not be saved. Your local content is still here.",
      onRetry,
      saveStatus: "error",
    });
    const message = screen.getByRole("textbox", { name: "Message" });

    fireEvent.change(message, { target: { value: "Still safely local" } });
    expect((message as HTMLTextAreaElement).value).toBe("Still safely local");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("queues selected files with the latest dirty snapshot", () => {
    const onAttachFiles =
      vi.fn<(files: readonly File[], snapshot: DraftEditorSnapshot) => void>();
    renderEditor({ onAttachFiles, saveStatus: "unsaved" });
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Body before attachment" },
    });
    const file = new File(["attachment"], "notes.txt", {
      type: "text/plain",
    });

    fireEvent.change(screen.getByLabelText("Add draft attachments"), {
      target: { files: [file] },
    });

    expect(onAttachFiles).toHaveBeenCalledWith(
      [file],
      expect.objectContaining({
        content: expect.objectContaining({
          textBody: "Body before attachment",
        }),
      })
    );
  });

  it("disables send without a recipient and while an attachment is pending", () => {
    const onSend = vi.fn<(snapshot: DraftEditorSnapshot) => void>();
    const withoutRecipient = Schema.decodeUnknownSync(DraftEditorContent)({
      bcc: [],
      cc: [],
      subject: "No recipient",
      to: [],
    });
    renderEditor({ initial: withoutRecipient, onSend });
    expect(
      (screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
        .disabled
    ).toBeTruthy();

    cleanup();
    onSend.mockClear();
    renderEditor({
      attachmentUploads: [
        {
          fileName: "notes.txt",
          id: "upload-1",
          progress: 20,
          retryable: true,
          size: 10,
          status: "uploading",
        },
      ],
      onSend,
    });
    expect(
      (screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
        .disabled
    ).toBeTruthy();
  });

  it("locks the click-time snapshot while an uncertain send can be retried", () => {
    renderEditor({
      error: "The send result could not be confirmed. Retry safely.",
      isSendUncertain: true,
      onRetry: vi.fn<() => void>(),
    });

    expect(
      (
        screen.getByRole("textbox", {
          name: "Message",
        }) as HTMLTextAreaElement
      ).disabled
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
        .disabled
    ).toBeTruthy();
  });

  it("renders specific oversized-message send guidance", () => {
    renderEditor({
      error: draftSendErrorText(
        400,
        "Message is too large for the email provider"
      ),
    });
    expect(
      screen.getByText(
        "This message is too large for the email provider. Remove attachments or shorten the content."
      )
    ).toBeDefined();
  });
});
