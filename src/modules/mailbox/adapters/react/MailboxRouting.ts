import * as Schema from "effect/Schema";

import {
  DraftId,
  FolderId,
  LabelId,
  MessageId,
  OutboundDeliveryId,
  SearchQuery,
  ThreadId,
} from "#/modules/mailbox/domain/Mailbox";

export const MailboxSearch = Schema.Struct({
  attachment: Schema.optional(Schema.Literal("true")),
  compose: Schema.optional(Schema.Literal("true")),
  draft: Schema.optional(DraftId),
  delivery: Schema.optional(OutboundDeliveryId),
  folder: Schema.optional(FolderId),
  label: Schema.optional(LabelId),
  message: Schema.optional(MessageId),
  q: Schema.optional(SearchQuery),
  read: Schema.optional(Schema.Literals(["read", "unread"])),
  starred: Schema.optional(Schema.Literal("true")),
  thread: Schema.optional(ThreadId),
}).check(
  Schema.makeFilter((search) => {
    if (search.folder !== undefined && search.label !== undefined) {
      return "folder and label cannot be selected together";
    }
    if (search.compose !== undefined && search.draft !== undefined) {
      return "compose and draft cannot be selected together";
    }
    if (
      (search.compose !== undefined || search.draft !== undefined) &&
      (search.thread !== undefined || search.message !== undefined)
    ) {
      return "draft editor and conversation cannot be selected together";
    }
    return (search.thread === undefined) === (search.message === undefined)
      ? undefined
      : "thread and message must be selected together";
  })
);

export type MailboxSearchState = Schema.Schema.Type<typeof MailboxSearch>;

export const decodeMailboxSearch = Schema.decodeUnknownSync(MailboxSearch);

const systemFolderPaths = {
  archive: "/mail/archive",
  drafts: "/mail/drafts",
  inbox: "/mail/inbox",
  scheduled: "/mail/scheduled",
  sent: "/mail/sent",
  spam: "/mail/spam",
  trash: "/mail/trash",
} as const;

export type SystemFolderId = keyof typeof systemFolderPaths;

export const isSystemFolderId = (folderId: string) =>
  Object.hasOwn(systemFolderPaths, folderId);

export const systemFolderPath = (folderId: SystemFolderId) =>
  systemFolderPaths[folderId];

export const mailboxRouteSearch = (search: MailboxSearchState) => ({
  attachment: search.attachment,
  delivery: search.delivery,
  message: search.message,
  q: search.q,
  read: search.read,
  starred: search.starred,
  thread: search.thread,
});

export const mailboxPathForSearch = (search: MailboxSearchState) => {
  if (search.draft !== undefined) {
    return `/mail/drafts/${encodeURIComponent(search.draft)}`;
  }
  if (search.compose === "true") {
    return "/mail/compose";
  }
  if (search.label !== undefined) {
    return `/mail/labels/${encodeURIComponent(search.label)}`;
  }
  const folderId = search.folder ?? "inbox";
  return isSystemFolderId(folderId)
    ? systemFolderPaths[folderId as SystemFolderId]
    : `/mail/folders/${encodeURIComponent(folderId)}`;
};

export const mailboxHref = (search: MailboxSearchState) => {
  const query = new URLSearchParams();
  const routeSearch = mailboxRouteSearch(search);
  if (routeSearch.message !== undefined) {
    query.set("message", routeSearch.message);
  }
  if (routeSearch.thread !== undefined) {
    query.set("thread", routeSearch.thread);
  }
  if (routeSearch.q !== undefined) {
    query.set("q", routeSearch.q);
  }
  if (routeSearch.read !== undefined) {
    query.set("read", routeSearch.read);
  }
  if (routeSearch.starred !== undefined) {
    query.set("starred", routeSearch.starred);
  }
  if (routeSearch.attachment !== undefined) {
    query.set("attachment", routeSearch.attachment);
  }
  if (routeSearch.delivery !== undefined) {
    query.set("delivery", routeSearch.delivery);
  }
  const encoded = query.toString();
  return `${mailboxPathForSearch(search)}${encoded === "" ? "" : `?${encoded}`}`;
};

export const mailboxSearchForPath = (
  pathname: string,
  search: MailboxSearchState
) => {
  const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [, section, resourceId] = segments;
  if (section === "compose") {
    return decodeMailboxSearch({
      ...mailboxRouteSearch(search),
      compose: "true",
    });
  }
  if (section === "drafts" && resourceId !== undefined) {
    return decodeMailboxSearch({
      ...mailboxRouteSearch(search),
      draft: resourceId,
      folder: "drafts",
    });
  }
  if (section === "labels" && resourceId !== undefined) {
    return decodeMailboxSearch({
      ...mailboxRouteSearch(search),
      label: resourceId,
    });
  }
  if (section === "folders" && resourceId !== undefined) {
    return decodeMailboxSearch({
      ...mailboxRouteSearch(search),
      folder: resourceId,
    });
  }
  return decodeMailboxSearch({
    ...mailboxRouteSearch(search),
    folder: section ?? "inbox",
  });
};
