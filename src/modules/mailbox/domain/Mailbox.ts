/* oxlint-disable max-classes-per-file -- Mailbox domain schemas are intentionally consolidated. */
import * as Schema from "effect/Schema";

import { ResourceId } from "#/shared/Resource";

export const MailboxId = ResourceId.pipe(
  Schema.brand("cloudflare-inbox/MailboxId")
);
export type MailboxId = Schema.Schema.Type<typeof MailboxId>;

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

export const ByteSize = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
  Schema.brand("cloudflare-inbox/ByteSize")
);
export type ByteSize = Schema.Schema.Type<typeof ByteSize>;

export const Sha256Digest = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
  Schema.brand("cloudflare-inbox/Sha256Digest")
);
export type Sha256Digest = Schema.Schema.Type<typeof Sha256Digest>;

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
