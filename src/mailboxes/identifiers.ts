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

export const OutboundDeliveryId = ResourceId.pipe(
  Schema.brand("cloudflare-inbox/OutboundDeliveryId")
);
export type OutboundDeliveryId = Schema.Schema.Type<typeof OutboundDeliveryId>;

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
