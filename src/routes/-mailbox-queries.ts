import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";

import {
  getMailboxContactPreferences,
  listMailboxDrafts,
  listMailboxMessages,
  searchMailboxContacts,
} from "#/apps/website/TanStackFunctions";
import {
  clearCachedAuthSession,
  handleMailboxReadDenial,
} from "#/modules/account-security/adapters/browser/AuthClient";
import type { MailboxMessageQueryState } from "#/modules/mailbox/adapters/react/MailboxViewLinks";
import { MailboxDraftListInput } from "#/modules/mailbox/application/MailboxDraftReading";
import { MailboxMessageListInput } from "#/modules/mailbox/application/MailboxMessageReading";
import type { MailboxMessageView } from "#/modules/mailbox/application/MailboxMessageReading";
import {
  ContactSearchResult,
  SearchContactsInput,
} from "#/modules/mailbox/domain/MailboxContact";
import {
  GetMailboxContactPreferenceQuery,
  MailboxContactPreference,
} from "#/modules/organization/application/UserMailboxContactPreferences";

const decodeMailboxDraftListInput = Schema.decodeUnknownSync(
  MailboxDraftListInput
);
const decodeMailboxMessageListInput = Schema.decodeUnknownSync(
  MailboxMessageListInput
);
const decodeContactSearchInput = Schema.decodeUnknownSync(SearchContactsInput);
const decodeContactSearchResult = Schema.decodeUnknownSync(ContactSearchResult);
const decodeContactPreferenceQuery = Schema.decodeUnknownSync(
  GetMailboxContactPreferenceQuery
);
const decodeContactPreference = Schema.decodeUnknownSync(
  MailboxContactPreference
);

const mailboxListStaleTime = 2 * 60_000;
const mailboxListGcTime = 60 * 60_000;

export class MailboxRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("Mailbox request failed");
    this.name = "MailboxRequestError";
    this.status = status;
  }
}

export const mailboxDraftListQueryOptions = ({
  mailboxId,
  queryClient,
  sessionId,
}: {
  readonly mailboxId: string;
  readonly queryClient: QueryClient;
  readonly sessionId: string;
}) =>
  infiniteQueryOptions({
    gcTime: mailboxListGcTime,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const result = await listMailboxDrafts({
        data: decodeMailboxDraftListInput({
          mailboxId,
          page: { cursor: pageParam, limit: 25 },
        }),
      });
      if (!result.ok) {
        if (result.status === 401) {
          await clearCachedAuthSession(queryClient);
        }
        throw new MailboxRequestError(result.status);
      }
      return result.drafts;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    queryKey: ["mailbox", "drafts", sessionId, mailboxId],
    retry: false,
    staleTime: mailboxListStaleTime,
  });

export const mailboxMessageListQueryOptions = ({
  filters,
  mailboxId,
  queryClient,
  sessionId,
  view,
}: {
  readonly filters: MailboxMessageQueryState;
  readonly mailboxId: string;
  readonly queryClient: QueryClient;
  readonly sessionId: string;
  readonly view: Schema.Schema.Type<typeof MailboxMessageView>;
}) =>
  infiniteQueryOptions({
    gcTime: mailboxListGcTime,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const result = await listMailboxMessages({
        data: decodeMailboxMessageListInput({
          ...view,
          cursor: pageParam,
          hasAttachment: filters.hasAttachment,
          query: filters.query,
          read:
            filters.read === undefined ? undefined : filters.read === "read",
          starred: filters.starred,
        }),
      });
      await handleMailboxReadDenial(queryClient, result);
      if (!result.ok) {
        throw new MailboxRequestError(result.status);
      }
      return result.messages;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    queryKey: [
      "mailbox",
      "messages",
      sessionId,
      mailboxId,
      view._tag,
      view._tag === "Folder" ? view.folderId : view.labelId,
      filters.query,
      filters.read,
      filters.starred,
      filters.hasAttachment,
    ],
    retry: false,
    staleTime: mailboxListStaleTime,
  });

export const mailboxContactSearchQueryOptions = ({
  mailboxId,
  query,
  queryClient,
  sessionId,
}: {
  readonly mailboxId: string;
  readonly query?: string;
  readonly queryClient: QueryClient;
  readonly sessionId: string;
}) => {
  const normalizedQuery = query?.trim();
  return queryOptions({
    gcTime: 10 * 60_000,
    queryFn: async () => {
      const result = await searchMailboxContacts({
        data: decodeContactSearchInput({
          mailboxId,
          limit: normalizedQuery === undefined ? 100 : 12,
          query: normalizedQuery,
        }),
      });
      await handleMailboxReadDenial(queryClient, result);
      if (!result.ok) {
        throw new MailboxRequestError(result.status);
      }
      return decodeContactSearchResult(result.contacts).contacts;
    },
    queryKey: [
      "mailbox",
      "contacts",
      sessionId,
      mailboxId,
      normalizedQuery ?? "recent",
    ],
    retry: false,
    staleTime: 2 * 60_000,
  });
};

export const mailboxContactPreferenceQueryOptions = ({
  mailboxId,
  queryClient,
  sessionId,
}: {
  readonly mailboxId: string;
  readonly queryClient: QueryClient;
  readonly sessionId: string;
}) =>
  queryOptions({
    queryFn: async () => {
      const result = await getMailboxContactPreferences({
        data: decodeContactPreferenceQuery({ mailboxId }),
      });
      await handleMailboxReadDenial(queryClient, result);
      if (!result.ok) {
        throw new MailboxRequestError(result.status);
      }
      return decodeContactPreference(result.preference);
    },
    queryKey: ["mailbox", "contact-preferences", sessionId, mailboxId],
    retry: false,
    staleTime: 30_000,
  });
