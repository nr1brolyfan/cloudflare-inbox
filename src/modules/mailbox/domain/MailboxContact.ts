import * as Schema from "effect/Schema";

import { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import { MailAddress } from "#/shared/MailAddress";
import { UnixMillis } from "#/shared/Temporal";

export const ContactSearchTerm = Schema.Trimmed.pipe(
  Schema.check(Schema.isLengthBetween(2, 100)),
  Schema.brand("cloudflare-inbox/ContactSearchTerm")
);
export type ContactSearchTerm = Schema.Schema.Type<typeof ContactSearchTerm>;

export const ContactSearchLimit = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 100 }))
);

export const SearchContactsInput = Schema.Struct({
  allParticipantsEnabledAt: Schema.optional(UnixMillis),
  mailboxId: MailboxId,
  query: Schema.optional(ContactSearchTerm),
  limit: ContactSearchLimit,
});
export type SearchContactsInput = Schema.Schema.Type<
  typeof SearchContactsInput
>;

export const ContactSuggestionList = Schema.Array(MailAddress).pipe(
  Schema.check(Schema.isLengthBetween(0, 100))
);

export const ContactSearchResult = Schema.Struct({
  contacts: ContactSuggestionList,
});
export type ContactSearchResult = Schema.Schema.Type<
  typeof ContactSearchResult
>;
