// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as Schema from "effect/Schema";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DraftEditor } from "#/inbox/draft-editor";
import { DraftEditorContent } from "#/mailboxes/draft-editing";

const initial = Schema.decodeUnknownSync(DraftEditorContent)({
  bcc: [],
  cc: [{ address: "copy@example.test" }],
  subject: "Initial subject",
  textBody: "Unsaved local body",
  to: [{ address: "person@example.test", displayName: "Person, Primary" }],
});

describe(DraftEditor, () => {
  afterEach(cleanup);

  it("parses recipients and submits plain-text editor content", () => {
    const onSave = vi.fn<(content: typeof initial) => void>();
    render(
      <DraftEditor
        initial={initial}
        isNew={false}
        isSaving={false}
        onClose={vi.fn<() => void>()}
        onSave={onSave}
        saved={false}
      />
    );

    expect(
      (
        screen.getByRole("textbox", {
          name: "To recipients",
        }) as HTMLInputElement
      ).value
    ).toBe('"Person, Primary" <person@example.test>');
    fireEvent.change(screen.getByRole("textbox", { name: "To recipients" }), {
      target: { value: "Next <next@example.test>, second@example.test" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), {
      target: { value: "Updated subject" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    expect(onSave).toHaveBeenCalledWith({
      bcc: [],
      cc: [{ address: "copy@example.test" }],
      subject: "Updated subject",
      textBody: "Unsaved local body",
      to: [
        { address: "next@example.test", displayName: "Next" },
        { address: "second@example.test" },
      ],
    });
  });

  it("keeps local fields visible and offers exact retry after a save error", () => {
    const onRetry = vi.fn<() => void>();
    render(
      <DraftEditor
        error="The draft could not be saved. Your local content is still here."
        initial={initial}
        isNew
        isSaving={false}
        onClose={vi.fn<() => void>()}
        onRetry={onRetry}
        onSave={vi.fn<(content: typeof initial) => void>()}
        saved={false}
      />
    );

    expect(
      (screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement)
        .value
    ).toBe("Unsaved local body");
    expect(screen.getByRole("alert").textContent).toContain(
      "local content is still here"
    );
    expect(
      screen
        .getByRole("button", { name: "Save draft" })
        .hasAttribute("disabled")
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("rejects invalid addresses without dispatching a save", () => {
    const onSave = vi.fn<(content: typeof initial) => void>();
    render(
      <DraftEditor
        initial={initial}
        isNew
        isSaving={false}
        onClose={vi.fn<() => void>()}
        onSave={onSave}
        saved={false}
      />
    );

    fireEvent.change(screen.getByRole("textbox", { name: "To recipients" }), {
      target: { value: "not-an-address" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "Check the recipient addresses"
    );
  });
});
