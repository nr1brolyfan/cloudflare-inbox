import { describe, expect, it } from "vitest";

import {
  cloudflareStructuredEmailMaximumBytes,
  cloudflareStructuredEmailSafetyOverheadBytes,
  cloudflareGeneratedDateHeaderBytes,
  cloudflareGeneratedDkimHeaderBytes,
  cloudflareGeneratedMessageIdHeaderBytes,
  cloudflareGeneratedMessageStructureBytes,
  cloudflareGeneratedMimeBoundaryBytesPerPart,
  estimateCloudflareStructuredEmailWireSize,
  isCloudflareStructuredEmailSizeAccepted,
} from "#/modules/mailbox/domain/CloudflareStructuredEmailSize";

const base = {
  attachments: [],
  bcc: [],
  cc: [],
  sender: { address: "sender@example.com" },
  subject: "",
  to: [{ address: "recipient@example.com" }],
} as const;

const bytes = (
  input: Parameters<typeof estimateCloudflareStructuredEmailWireSize>[0]
) => {
  const estimate = estimateCloudflareStructuredEmailWireSize(input);
  expect(estimate._tag).toBe("Estimated");
  return estimate._tag === "Estimated" ? estimate.bytes : 0;
};

describe("Cloudflare structured email wire-size estimator", () => {
  it("accepts the last adjacent body length below 5 MiB and rejects the next", () => {
    const below = estimateCloudflareStructuredEmailWireSize({
      ...base,
      text: "a".repeat(1_332_694),
    });
    const above = estimateCloudflareStructuredEmailWireSize({
      ...base,
      text: "a".repeat(1_332_695),
    });

    expect(below).toStrictEqual({ _tag: "Estimated", bytes: 5_242_878 });
    expect(above).toStrictEqual({ _tag: "Estimated", bytes: 5_242_881 });
    expect(isCloudflareStructuredEmailSizeAccepted(below)).toBeTruthy();
    expect(isCloudflareStructuredEmailSizeAccepted(above)).toBeFalsy();
    expect(cloudflareStructuredEmailMaximumBytes).toBe(5 * 1024 * 1024);
  });

  it("accepts the exact adjacent attachment boundary after base64 folding", () => {
    const attachment = {
      disposition: "attachment" as const,
      fileName: "boundary.pdf",
      mimeType: "application/pdf",
    };
    const below = estimateCloudflareStructuredEmailWireSize({
      ...base,
      attachments: [{ ...attachment, byteLength: 3_037_989 }],
      text: "body",
    });
    const above = estimateCloudflareStructuredEmailWireSize({
      ...base,
      attachments: [{ ...attachment, byteLength: 3_037_990 }],
      text: "body",
    });

    expect(below).toStrictEqual({ _tag: "Estimated", bytes: 5_242_879 });
    expect(above).toStrictEqual({ _tag: "Estimated", bytes: 5_242_883 });
    expect(isCloudflareStructuredEmailSizeAccepted(below)).toBeTruthy();
    expect(isCloudflareStructuredEmailSizeAccepted(above)).toBeFalsy();
  });

  it("charges worst-case UTF-8 MIME expansion for Unicode fields and bodies", () => {
    const ascii = bytes({
      ...base,
      sender: { address: "sender@example.com", displayName: "Name" },
      subject: "abcd",
      text: "abcd",
      to: [{ address: "recipient@example.com", displayName: "Name" }],
    });
    const unicode = bytes({
      ...base,
      sender: { address: "sender@example.com", displayName: "😀😀😀😀" },
      subject: "😀😀😀😀",
      text: "😀😀😀😀",
      to: [{ address: "recipient@example.com", displayName: "😀😀😀😀" }],
    });

    expect(unicode).toBeGreaterThan(ascii + 100);
  });

  it("includes base64 CRLF folding and every attachment metadata field", () => {
    const plain = bytes({
      ...base,
      attachments: [
        {
          byteLength: 57,
          disposition: "attachment",
          fileName: "a.txt",
          mimeType: "text/plain",
        },
      ],
      text: "body",
    });
    const folded = bytes({
      ...base,
      attachments: [
        {
          byteLength: 58,
          contentId: "image-part@example.com",
          disposition: "inline",
          fileName: "résumé-long-name.pdf",
          mimeType: "application/pdf",
        },
        {
          byteLength: 114,
          disposition: "attachment",
          fileName: "second.bin",
          mimeType: "application/octet-stream",
        },
      ],
      text: "body",
    });

    expect(plain).toBe(1_085_650);
    expect(folded).toBe(1_086_814);
  });

  it("has exact folding, filename, content-id, and threading increments", () => {
    const attachment = {
      disposition: "attachment" as const,
      fileName: "a.txt",
      mimeType: "text/plain",
    };
    const atOneBase64Line = bytes({
      ...base,
      attachments: [{ ...attachment, byteLength: 57 }],
      text: "body",
    });
    const overOneBase64Line = bytes({
      ...base,
      attachments: [{ ...attachment, byteLength: 58 }],
      text: "body",
    });
    const encodedFilename = bytes({
      ...base,
      attachments: [
        {
          ...attachment,
          byteLength: 57,
          fileName: "résumé-long-name.pdf",
        },
      ],
      text: "body",
    });
    const inlineContentId = bytes({
      ...base,
      attachments: [
        {
          byteLength: 57,
          contentId: "image-part@example.com",
          disposition: "inline",
          fileName: "a.txt",
          mimeType: "text/plain",
        },
      ],
      text: "body",
    });
    const threading = bytes({
      ...base,
      text: "body",
      threading: {
        inReplyTo: "<parent@example.com>",
        references: ["<root@example.com>", "<parent@example.com>"],
      },
    });

    expect(overOneBase64Line - atOneBase64Line).toBe(6);
    expect(encodedFilename - atOneBase64Line).toBe(108);
    expect(inlineContentId - atOneBase64Line).toBe(104);
    expect(threading - bytes({ ...base, text: "body" })).toBe(260);
  });

  it("charges recipient folding plus Reply threading headers", () => {
    const ordinary = bytes({ ...base, text: "body" });
    const reply = bytes({
      ...base,
      bcc: [{ address: "hidden@example.com", displayName: "Hidden copy" }],
      cc: Array.from({ length: 20 }, (_, index) => ({
        address: `copy-${index}@example.com`,
        displayName: `Copy ${index}`,
      })),
      text: "body",
      threading: {
        inReplyTo: "<parent@example.com>",
        references: ["<root@example.com>", "<parent@example.com>"],
      },
    });

    expect(reply).toBeGreaterThan(ordinary + 1000);
  });

  it("fails closed on malformed lengths and checked arithmetic overflow", () => {
    const attachment = {
      disposition: "attachment" as const,
      fileName: "large.bin",
      mimeType: "application/octet-stream",
    };

    expect(
      estimateCloudflareStructuredEmailWireSize({
        ...base,
        attachments: [{ ...attachment, byteLength: Number.NaN }],
        text: "body",
      })
    ).toStrictEqual({ _tag: "Invalid", reason: "malformed-length" });
    expect(
      estimateCloudflareStructuredEmailWireSize({
        ...base,
        attachments: [{ ...attachment, byteLength: Number.MAX_SAFE_INTEGER }],
        text: "body",
      })
    ).toStrictEqual({ _tag: "Invalid", reason: "arithmetic-overflow" });
  });

  it("always includes the documented fixed provider-generation reserve", () => {
    const estimate = bytes({ ...base, text: "" });
    expect({
      date: cloudflareGeneratedDateHeaderBytes,
      dkim: cloudflareGeneratedDkimHeaderBytes,
      messageId: cloudflareGeneratedMessageIdHeaderBytes,
      mimeBoundary: cloudflareGeneratedMimeBoundaryBytesPerPart,
      reserve: cloudflareStructuredEmailSafetyOverheadBytes,
      structure: cloudflareGeneratedMessageStructureBytes,
    }).toStrictEqual({
      date: 128,
      dkim: 32 * 1024,
      messageId: 2048,
      mimeBoundary: 256,
      reserve: 1024 * 1024,
      structure: 512,
    });
    expect(estimate).toBeGreaterThan(
      cloudflareStructuredEmailSafetyOverheadBytes +
        cloudflareGeneratedDateHeaderBytes +
        cloudflareGeneratedMessageIdHeaderBytes +
        cloudflareGeneratedDkimHeaderBytes +
        cloudflareGeneratedMessageStructureBytes
    );
  });
});
