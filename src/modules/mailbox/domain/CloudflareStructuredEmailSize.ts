export const cloudflareStructuredEmailMaximumBytes = 5 * 1024 * 1024;
export const cloudflareStructuredEmailSafetyOverheadBytes = 1024 * 1024;
export const cloudflareGeneratedDateHeaderBytes = 128;
export const cloudflareGeneratedMessageIdHeaderBytes = 2048;
export const cloudflareGeneratedDkimHeaderBytes = 32 * 1024;
export const cloudflareGeneratedMimeBoundaryBytesPerPart = 256;
export const cloudflareGeneratedMessageStructureBytes = 512;
export const mimeBase64LineLength = 76;
export const mimeQuotedPrintableLineLength = 75;

const crlfBytes = 2;
const foldedHeaderLineLength = 75;
const mimeEncodedWordPayloadBytes = 20;
const mimeEncodedWordWrapperBytes = 12;
const mimePartFixedBytes = 256;

export interface CloudflareStructuredEmailAttachmentSize {
  readonly byteLength: number;
  readonly contentId?: string;
  readonly disposition: "attachment" | "inline";
  readonly fileName: string;
  readonly mimeType: string;
}

export interface CloudflareStructuredEmailAddress {
  readonly address: string;
  readonly displayName?: string;
}

export interface CloudflareStructuredEmailSizeInput {
  readonly attachments: readonly CloudflareStructuredEmailAttachmentSize[];
  readonly bcc: readonly CloudflareStructuredEmailAddress[];
  readonly cc: readonly CloudflareStructuredEmailAddress[];
  readonly html?: string;
  readonly sender: CloudflareStructuredEmailAddress;
  readonly subject: string;
  readonly text?: string;
  readonly threading?: {
    readonly inReplyTo: string;
    readonly references: readonly string[];
  };
  readonly to: readonly CloudflareStructuredEmailAddress[];
}

export type CloudflareStructuredEmailSizeEstimate =
  | {
      readonly _tag: "Invalid";
      readonly reason: "arithmetic-overflow" | "malformed-length";
    }
  | { readonly _tag: "Estimated"; readonly bytes: number };

const invalid = (
  reason: "arithmetic-overflow" | "malformed-length"
): CloudflareStructuredEmailSizeEstimate => ({ _tag: "Invalid", reason });

const checkedAdd = (left: number, right: number) => {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) {
    return;
  }
  const result = left + right;
  return Number.isSafeInteger(result) ? result : undefined;
};

const checkedMultiply = (value: number, multiplier: number) => {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    !Number.isSafeInteger(multiplier) ||
    multiplier < 0 ||
    value > Math.floor(Number.MAX_SAFE_INTEGER / multiplier)
  ) {
    return;
  }
  return value * multiplier;
};

const checkedCeilDivide = (value: number, divisor: number) => {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    !Number.isSafeInteger(divisor) ||
    divisor <= 0
  ) {
    return;
  }
  const adjusted = checkedAdd(value, divisor - 1);
  return adjusted === undefined ? undefined : Math.floor(adjusted / divisor);
};

const utf8Bytes = (value: unknown) =>
  typeof value === "string"
    ? new TextEncoder().encode(value).byteLength
    : undefined;

const checkedSum = (values: readonly (number | undefined)[]) => {
  let total = 0;
  for (const value of values) {
    if (value === undefined || value < 0) {
      return;
    }
    const next = checkedAdd(total, value);
    if (next === undefined) {
      return;
    }
    total = next;
  }
  return total;
};

const foldedBytes = (contentBytes: number, lineLength: number) => {
  const lines = checkedCeilDivide(contentBytes, lineLength);
  const folding =
    lines === undefined ? undefined : checkedMultiply(lines, crlfBytes + 1);
  return checkedSum([contentBytes, folding]);
};

// Q encoding can turn every UTF-8 byte into three wire bytes. Small encoded-word
// chunks and a fold per chunk intentionally overestimate real provider output.
const mimeTextBytes = (value: unknown) => {
  const bytes = utf8Bytes(value);
  if (bytes === undefined) {
    return;
  }
  const payload = checkedMultiply(bytes, 3);
  const words = checkedCeilDivide(bytes, mimeEncodedWordPayloadBytes);
  const wrappers =
    words === undefined
      ? undefined
      : checkedMultiply(words, mimeEncodedWordWrapperBytes + crlfBytes + 1);
  return checkedSum([payload, wrappers]);
};

const headerBytes = (name: string, contentBytes: number | undefined) => {
  if (contentBytes === undefined) {
    return;
  }
  const folded = foldedBytes(contentBytes, foldedHeaderLineLength);
  return checkedSum([name.length, 2, folded, crlfBytes]);
};

const addressBytes = (address: CloudflareStructuredEmailAddress) => {
  const mailbox = utf8Bytes(address.address);
  if (mailbox === undefined) {
    return;
  }
  if (address.displayName === undefined) {
    return mailbox;
  }
  return checkedSum([mimeTextBytes(address.displayName), mailbox, 3]);
};

const addressHeaderBytes = (
  name: string,
  addresses: readonly CloudflareStructuredEmailAddress[]
) =>
  addresses.length === 0
    ? 0
    : headerBytes(
        name,
        checkedSum([
          ...addresses.map(addressBytes),
          checkedMultiply(addresses.length - 1, 2),
        ])
      );

const bodyPartBytes = (value: unknown) => {
  const bytes = utf8Bytes(value);
  const encoded = bytes === undefined ? undefined : checkedMultiply(bytes, 3);
  const softLines =
    encoded === undefined
      ? undefined
      : checkedCeilDivide(encoded, mimeQuotedPrintableLineLength);
  const softFolding =
    softLines === undefined ? undefined : checkedMultiply(softLines, 3);
  return checkedSum([mimePartFixedBytes, encoded, softFolding, crlfBytes]);
};

const attachmentBytes = (
  attachment: CloudflareStructuredEmailAttachmentSize
) => {
  if (
    !Number.isSafeInteger(attachment.byteLength) ||
    attachment.byteLength < 0
  ) {
    return;
  }
  const groups = checkedCeilDivide(attachment.byteLength, 3);
  const encoded = groups === undefined ? undefined : checkedMultiply(groups, 4);
  const lines =
    encoded === undefined
      ? undefined
      : checkedCeilDivide(encoded, mimeBase64LineLength);
  const folding =
    lines === undefined ? undefined : checkedMultiply(lines, crlfBytes);
  const fileNameBytes = utf8Bytes(attachment.fileName);
  const encodedFileName =
    fileNameBytes === undefined ? undefined : checkedMultiply(fileNameBytes, 3);
  const fileNameMetadata =
    encodedFileName === undefined
      ? undefined
      : checkedMultiply(foldedBytes(encodedFileName, 60) ?? Number.NaN, 2);
  const mimeTypeMetadata = headerBytes(
    "Content-Type",
    mimeTextBytes(attachment.mimeType)
  );
  const dispositionMetadata = headerBytes(
    "Content-Disposition",
    mimeTextBytes(attachment.disposition)
  );
  const contentIdMetadata =
    attachment.contentId === undefined
      ? 0
      : headerBytes("Content-ID", mimeTextBytes(attachment.contentId));
  return checkedSum([
    mimePartFixedBytes,
    encoded,
    folding,
    fileNameMetadata,
    mimeTypeMetadata,
    dispositionMetadata,
    contentIdMetadata,
    crlfBytes,
  ]);
};

/**
 * Conservative upper estimate for Cloudflare's structured Email Sending wire
 * message. Known provider-generated Date, Message-ID, DKIM, MIME-boundary, and
 * structure costs are estimated independently. Because Cloudflare publishes no
 * exact serializer bounds, a deliberately restrictive additional 1 MiB reserve
 * covers unknown implementation variance. Cloudflare remains authoritative and
 * validates the live serialized message independently.
 */
export const estimateCloudflareStructuredEmailWireSize = (
  input: CloudflareStructuredEmailSizeInput
): CloudflareStructuredEmailSizeEstimate => {
  const bodyValues =
    input.text === undefined && input.html === undefined
      ? [""]
      : [input.text, input.html].filter((value) => value !== undefined);
  const references = input.threading?.references.join(" ");
  const mimePartCount = input.attachments.length + bodyValues.length;
  const generatedMimeBoundaries = checkedMultiply(
    mimePartCount + 1,
    cloudflareGeneratedMimeBoundaryBytesPerPart
  );
  const bytes = checkedSum([
    // Cloudflare does not publish serializer bounds. Keep unknown variance
    // separate from the generated components explicitly estimated below.
    cloudflareStructuredEmailSafetyOverheadBytes,
    cloudflareGeneratedDateHeaderBytes,
    cloudflareGeneratedMessageIdHeaderBytes,
    cloudflareGeneratedDkimHeaderBytes,
    generatedMimeBoundaries,
    cloudflareGeneratedMessageStructureBytes,
    headerBytes("Subject", mimeTextBytes(input.subject)),
    addressHeaderBytes("From", [input.sender]),
    addressHeaderBytes("To", input.to),
    addressHeaderBytes("Cc", input.cc),
    addressHeaderBytes("Bcc", input.bcc),
    input.threading === undefined
      ? 0
      : headerBytes("In-Reply-To", mimeTextBytes(input.threading.inReplyTo)),
    references === undefined
      ? 0
      : headerBytes("References", mimeTextBytes(references)),
    ...bodyValues.map(bodyPartBytes),
    ...input.attachments.map(attachmentBytes),
  ]);

  if (bytes === undefined) {
    const malformedLength = input.attachments.some(
      (attachment) =>
        !Number.isSafeInteger(attachment.byteLength) ||
        attachment.byteLength < 0
    );
    return invalid(
      malformedLength ? "malformed-length" : "arithmetic-overflow"
    );
  }
  return { _tag: "Estimated", bytes };
};

export const isCloudflareStructuredEmailSizeAccepted = (
  estimate: CloudflareStructuredEmailSizeEstimate
) =>
  estimate._tag === "Estimated" &&
  estimate.bytes <= cloudflareStructuredEmailMaximumBytes;
