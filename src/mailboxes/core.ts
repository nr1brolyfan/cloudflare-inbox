/* oxlint-disable max-classes-per-file -- Core domain schemas are intentionally consolidated. */
import { UserIdSchema } from "@effect-auth/core/Identifiers";
import * as Schema from "effect/Schema";

const ResourceId = Schema.Trimmed.pipe(
  Schema.check(Schema.isLengthBetween(1, 128))
);

export const MailboxId = ResourceId.pipe(
  Schema.brand("cloudflare-inbox/MailboxId")
);
export type MailboxId = Schema.Schema.Type<typeof MailboxId>;

export const MailboxAddressId = ResourceId.pipe(
  Schema.brand("cloudflare-inbox/MailboxAddressId")
);
export type MailboxAddressId = Schema.Schema.Type<typeof MailboxAddressId>;

export const FolderId = ResourceId.pipe(
  Schema.brand("cloudflare-inbox/FolderId")
);
export type FolderId = Schema.Schema.Type<typeof FolderId>;

export const LabelId = ResourceId.pipe(
  Schema.brand("cloudflare-inbox/LabelId")
);
export type LabelId = Schema.Schema.Type<typeof LabelId>;

export const MessageId = ResourceId.pipe(
  Schema.brand("cloudflare-inbox/MessageId")
);
export type MessageId = Schema.Schema.Type<typeof MessageId>;

export const ThreadId = ResourceId.pipe(
  Schema.brand("cloudflare-inbox/ThreadId")
);
export type ThreadId = Schema.Schema.Type<typeof ThreadId>;

export const AttachmentId = ResourceId.pipe(
  Schema.brand("cloudflare-inbox/AttachmentId")
);
export type AttachmentId = Schema.Schema.Type<typeof AttachmentId>;

export const DraftId = ResourceId.pipe(
  Schema.brand("cloudflare-inbox/DraftId")
);
export type DraftId = Schema.Schema.Type<typeof DraftId>;

export const RuleId = ResourceId.pipe(Schema.brand("cloudflare-inbox/RuleId"));
export type RuleId = Schema.Schema.Type<typeof RuleId>;

export const AsyncRuleJobId = ResourceId.pipe(
  Schema.brand("cloudflare-inbox/AsyncRuleJobId")
);
export type AsyncRuleJobId = Schema.Schema.Type<typeof AsyncRuleJobId>;

export const OutboundDeliveryId = ResourceId.pipe(
  Schema.brand("cloudflare-inbox/OutboundDeliveryId")
);
export type OutboundDeliveryId = Schema.Schema.Type<typeof OutboundDeliveryId>;

export const InboundIngestId = ResourceId.pipe(
  Schema.brand("cloudflare-inbox/InboundIngestId")
);
export type InboundIngestId = Schema.Schema.Type<typeof InboundIngestId>;

export const OperationId = ResourceId.pipe(
  Schema.brand("cloudflare-inbox/OperationId")
);
export type OperationId = Schema.Schema.Type<typeof OperationId>;

export const RfcMessageId = Schema.Trimmed.pipe(
  Schema.check(Schema.isLengthBetween(1, 998)),
  Schema.brand("cloudflare-inbox/RfcMessageId")
);
export type RfcMessageId = Schema.Schema.Type<typeof RfcMessageId>;

export const Cursor = Schema.Trimmed.pipe(
  Schema.check(Schema.isLengthBetween(1, 2048)),
  Schema.brand("cloudflare-inbox/Cursor")
);
export type Cursor = Schema.Schema.Type<typeof Cursor>;

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

export const AttemptCount = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
  Schema.brand("cloudflare-inbox/AttemptCount")
);
export type AttemptCount = Schema.Schema.Type<typeof AttemptCount>;

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

export const RuleName = DisplayNameText.pipe(
  Schema.brand("cloudflare-inbox/RuleName")
);
export type RuleName = Schema.Schema.Type<typeof RuleName>;

export const RulePriority = Schema.Int.pipe(
  Schema.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(1_000_000)
  ),
  Schema.brand("cloudflare-inbox/RulePriority")
);
export type RulePriority = Schema.Schema.Type<typeof RulePriority>;

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

export const NormalizedEmailAddress = EmailAddress.pipe(
  Schema.check(
    Schema.makeFilter<EmailAddress>((value) => {
      const separator = value.lastIndexOf("@");
      const domain = value.slice(separator + 1);
      return domain === domain.toLowerCase()
        ? undefined
        : "must contain a lowercase domain";
    })
  ),
  Schema.brand("cloudflare-inbox/NormalizedEmailAddress")
);
export type NormalizedEmailAddress = Schema.Schema.Type<
  typeof NormalizedEmailAddress
>;

/** DNS domains are case-insensitive; SMTP local parts remain case-sensitive. */
export const normalizeEmailAddressDomain = (
  address: EmailAddress
): NormalizedEmailAddress => {
  const separator = address.lastIndexOf("@");
  return Schema.decodeUnknownSync(NormalizedEmailAddress)(
    `${address.slice(0, separator)}@${address.slice(separator + 1).toLowerCase()}`
  );
};

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

export const ContentId = Schema.Trimmed.pipe(
  Schema.check(Schema.isLengthBetween(1, 998)),
  Schema.brand("cloudflare-inbox/ContentId")
);
export type ContentId = Schema.Schema.Type<typeof ContentId>;

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

export const hasSearchableMessageTerm = (value: string) =>
  /[\p{L}\p{N}]/u.test(value);

export const SearchQuery = Schema.Trim.pipe(
  Schema.check(
    Schema.isLengthBetween(1, 500),
    Schema.makeFilter<string>((value) =>
      hasSearchableMessageTerm(value)
        ? undefined
        : "must contain a searchable letter or number"
    )
  ),
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

export class MailAddress extends Schema.Class<MailAddress>(
  "cloudflare-inbox/MailAddress"
)({
  address: EmailAddress,
  displayName: Schema.optional(Schema.String),
}) {}

export class MailboxRecord extends Schema.Class<MailboxRecord>(
  "cloudflare-inbox/MailboxRecord"
)({
  createdAt: UnixMillis,
  createdByUserId: UserIdSchema,
  displayName: MailboxDisplayName,
  id: MailboxId,
  status: Schema.Literal("active"),
  updatedAt: UnixMillis,
  version: Version,
}) {}

export const MailboxRecordSchema = MailboxRecord.check(
  Schema.makeFilter((mailbox) =>
    mailbox.updatedAt >= mailbox.createdAt
      ? undefined
      : "updatedAt cannot be earlier than createdAt"
  )
);
