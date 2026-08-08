import * as Schema from "effect/Schema";

import { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import { EmailAddress } from "#/shared/EmailAddress";
import { OperationId } from "#/shared/Operation";
import { UnixMillis, Version } from "#/shared/Temporal";

export const ContactSearchTerm = Schema.Trimmed.pipe(
  Schema.check(Schema.isLengthBetween(2, 100)),
  Schema.brand("cloudflare-inbox/ContactSearchTerm")
);
export type ContactSearchTerm = Schema.Schema.Type<typeof ContactSearchTerm>;

export const ContactSearchLimit = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 100 }))
);

export const SearchContactsInput = Schema.Struct({
  mailboxId: MailboxId,
  mode: Schema.optional(Schema.Literals(["all", "saved", "suggested"])),
  query: Schema.optional(ContactSearchTerm),
  limit: ContactSearchLimit,
});
export type SearchContactsInput = Schema.Schema.Type<
  typeof SearchContactsInput
>;

export const ContactUserId = Schema.Trimmed.pipe(
  Schema.check(Schema.isLengthBetween(1, 128))
);

export const ContactDetail = Schema.Struct({
  address: EmailAddress,
  displayName: Schema.optional(Schema.String),
  saved: Schema.Boolean,
  savedAt: Schema.optional(UnixMillis),
  version: Schema.optional(Version),
  firstInteractionAt: Schema.optional(UnixMillis),
  lastInteractionAt: Schema.optional(UnixMillis),
  receivedCount: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  sentCount: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type ContactDetail = Schema.Schema.Type<typeof ContactDetail>;

export const ContactSuggestionList = Schema.Array(ContactDetail).pipe(
  Schema.check(Schema.isLengthBetween(0, 100))
);

export const ContactSearchResult = Schema.Struct({
  contacts: ContactSuggestionList,
});
export type ContactSearchResult = Schema.Schema.Type<
  typeof ContactSearchResult
>;

export const TrustedListContactsInput = Schema.Struct({
  ...SearchContactsInput.fields,
  allParticipantsEnabledAt: Schema.optional(UnixMillis),
  mode: Schema.Literals(["all", "saved", "suggested"]),
  userId: ContactUserId,
});
export type TrustedListContactsInput = Schema.Schema.Type<
  typeof TrustedListContactsInput
>;

export const GetContactInput = Schema.Struct({
  address: EmailAddress,
  mailboxId: MailboxId,
});
export type GetContactInput = Schema.Schema.Type<typeof GetContactInput>;

export const TrustedGetContactInput = Schema.Struct({
  ...GetContactInput.fields,
  allParticipantsEnabledAt: Schema.optional(UnixMillis),
  userId: ContactUserId,
});

const ManualContactDisplayName = Schema.Trimmed.pipe(
  Schema.check(Schema.isLengthBetween(1, 200))
);

export const SaveContactCommand = Schema.Struct({
  displayName: Schema.optional(ManualContactDisplayName),
  email: EmailAddress,
  expectedVersion: Schema.optional(Version),
  mailboxId: MailboxId,
  operationId: OperationId,
});
export type SaveContactCommand = Schema.Schema.Type<typeof SaveContactCommand>;

export const TrustedSaveContactCommand = Schema.Struct({
  ...SaveContactCommand.fields,
  userId: ContactUserId,
});
export type TrustedSaveContactCommand = Schema.Schema.Type<
  typeof TrustedSaveContactCommand
>;

export const RemoveContactCommand = Schema.Struct({
  email: EmailAddress,
  expectedVersion: Schema.optional(Version),
  mailboxId: MailboxId,
  operationId: OperationId,
});
export type RemoveContactCommand = Schema.Schema.Type<
  typeof RemoveContactCommand
>;

export const TrustedRemoveContactCommand = Schema.Struct({
  ...RemoveContactCommand.fields,
  userId: ContactUserId,
});
export type TrustedRemoveContactCommand = Schema.Schema.Type<
  typeof TrustedRemoveContactCommand
>;

export const RemoveContactResult = Schema.Struct({
  address: EmailAddress,
  removed: Schema.Boolean,
});
export type RemoveContactResult = Schema.Schema.Type<
  typeof RemoveContactResult
>;
