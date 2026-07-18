import * as Schema from "effect/Schema";

const DisplayNameText = Schema.Trim.pipe(
  Schema.check(
    Schema.makeFilter<string>((value) =>
      [...value].length >= 1 && [...value].length <= 200
        ? undefined
        : "must contain between 1 and 200 Unicode code points"
    )
  )
);

export const UnixMillis = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
  Schema.brand("cloudflare-inbox/UnixMillis")
);
export type UnixMillis = Schema.Schema.Type<typeof UnixMillis>;

export const Version = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1)),
  Schema.brand("cloudflare-inbox/Version")
);
export type Version = Schema.Schema.Type<typeof Version>;

export const ByteSize = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
  Schema.brand("cloudflare-inbox/ByteSize")
);
export type ByteSize = Schema.Schema.Type<typeof ByteSize>;

export const PageSize = Schema.Int.pipe(
  Schema.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(100)
  ),
  Schema.brand("cloudflare-inbox/PageSize")
);
export type PageSize = Schema.Schema.Type<typeof PageSize>;

export const MailboxDisplayName = DisplayNameText.pipe(
  Schema.brand("cloudflare-inbox/MailboxDisplayName")
);
export type MailboxDisplayName = Schema.Schema.Type<typeof MailboxDisplayName>;

export const FolderName = DisplayNameText.pipe(
  Schema.brand("cloudflare-inbox/FolderName")
);
export type FolderName = Schema.Schema.Type<typeof FolderName>;

export const LabelName = DisplayNameText.pipe(
  Schema.brand("cloudflare-inbox/LabelName")
);
export type LabelName = Schema.Schema.Type<typeof LabelName>;

export const EmailAddress = Schema.Trimmed.pipe(
  Schema.check(
    Schema.isLengthBetween(3, 320),
    Schema.makeFilter<string>((value) => {
      const separator = value.lastIndexOf("@");
      if (separator <= 0 || separator !== value.indexOf("@")) {
        return "must contain one local part and one domain";
      }
      const local = value.slice(0, separator);
      const domain = value.slice(separator + 1);
      if (
        local.length > 64 ||
        local.startsWith(".") ||
        local.endsWith(".") ||
        local.includes("..") ||
        !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/u.test(local)
      ) {
        return "must contain a valid dot-atom local part";
      }
      const labels = domain.split(".");
      return labels.length >= 2 &&
        labels.every(
          (label) =>
            label.length >= 1 &&
            label.length <= 63 &&
            /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(label)
        )
        ? undefined
        : "must contain a valid DNS domain";
    })
  ),
  Schema.brand("cloudflare-inbox/EmailAddress")
);
export type EmailAddress = Schema.Schema.Type<typeof EmailAddress>;

export const FileName = Schema.Trim.pipe(
  Schema.check(Schema.isLengthBetween(1, 255)),
  Schema.brand("cloudflare-inbox/FileName")
);
export type FileName = Schema.Schema.Type<typeof FileName>;

export const MimeType = Schema.Trimmed.pipe(
  Schema.check(
    Schema.isLengthBetween(3, 255),
    Schema.isPattern(/^[^\s/]+\/[^\s/]+$/u)
  ),
  Schema.brand("cloudflare-inbox/MimeType")
);
export type MimeType = Schema.Schema.Type<typeof MimeType>;

export const MessageSubject = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(998)),
  Schema.brand("cloudflare-inbox/MessageSubject")
);
export type MessageSubject = Schema.Schema.Type<typeof MessageSubject>;

export const MessageSnippet = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(500)),
  Schema.brand("cloudflare-inbox/MessageSnippet")
);
export type MessageSnippet = Schema.Schema.Type<typeof MessageSnippet>;

export const SearchQuery = Schema.Trim.pipe(
  Schema.check(Schema.isLengthBetween(1, 500)),
  Schema.brand("cloudflare-inbox/SearchQuery")
);
export type SearchQuery = Schema.Schema.Type<typeof SearchQuery>;

export const MessageDirection = Schema.Literals(["inbound", "outbound"]);
export type MessageDirection = Schema.Schema.Type<typeof MessageDirection>;

export const FolderKind = Schema.Literals([
  "inbox",
  "sent",
  "drafts",
  "scheduled",
  "archive",
  "spam",
  "trash",
  "custom",
]);
export type FolderKind = Schema.Schema.Type<typeof FolderKind>;
