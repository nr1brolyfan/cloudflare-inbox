/* oxlint-disable max-classes-per-file -- HTML contract, error and service form one cohesive use case. */
import type { CurrentPrincipal } from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { parse, serialize } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";

import { isSafeInlineImageMimeType } from "#/modules/mailbox/application/MailboxInlineAttachmentReading";
import {
  FolderId,
  LabelId,
  MailboxId,
  MessageId,
} from "#/modules/mailbox/domain/Mailbox";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import { MailboxAuthorization } from "#/modules/mailbox/ports/MailboxAuthorization";
import type { MailboxAuthorizationError } from "#/modules/mailbox/ports/MailboxAuthorization";
import { MailboxMessageRepository } from "#/modules/mailbox/ports/MailboxMessageRepository";
import type { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";

const messageHtmlCsp = (imageSource: string) =>
  [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "script-src 'none'",
    "style-src 'unsafe-inline'",
    `img-src ${imageSource}`,
    "font-src 'none'",
    "media-src 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "sandbox allow-popups allow-popups-to-escape-sandbox allow-same-origin",
    "frame-ancestors 'self'",
  ].join("; ");

export const mailboxMessageHtmlCsp = messageHtmlCsp("'none'");

export const mailboxMessageHtmlCspForOrigin = (origin: string) =>
  messageHtmlCsp(new URL(origin).origin);

const SandboxedMessageHtmlDocument = Schema.String.pipe(
  Schema.brand("cloudflare-inbox/SandboxedMessageHtmlDocument")
);

export const MailboxMessageHtmlInput = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Folder"),
    folderId: FolderId,
    mailboxId: MailboxId,
    messageId: MessageId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Label"),
    labelId: LabelId,
    mailboxId: MailboxId,
    messageId: MessageId,
  }),
]);
export type MailboxMessageHtmlInput = Schema.Schema.Type<
  typeof MailboxMessageHtmlInput
>;

export const MailboxMessageHtmlResult = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Folder"),
    document: SandboxedMessageHtmlDocument,
    folderId: FolderId,
    mailboxId: MailboxId,
    messageId: MessageId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Label"),
    document: SandboxedMessageHtmlDocument,
    labelId: LabelId,
    mailboxId: MailboxId,
    messageId: MessageId,
  }),
]);
export type MailboxMessageHtmlResult = Schema.Schema.Type<
  typeof MailboxMessageHtmlResult
>;

export class MailboxMessageHtmlError extends Data.TaggedError(
  "MailboxMessageHtmlError"
)<{
  readonly cause?: unknown;
  readonly message: string;
  readonly reason: "not-found" | "storage";
}> {}

export interface MailboxMessageHtmlReadingService {
  readonly get: (
    input: MailboxMessageHtmlInput
  ) => Effect.Effect<
    MailboxMessageHtmlResult,
    MailboxAuthorizationError | MailboxMessageHtmlError,
    CurrentPrincipal
  >;
}

const htmlError = (reason: "not-found" | "storage", cause?: unknown) =>
  new MailboxMessageHtmlError({
    cause,
    message:
      reason === "not-found"
        ? "Mailbox message HTML was not found"
        : "Mailbox message HTML could not be loaded",
    reason,
  });

const mapRepositoryError = (
  error: MailboxDomainError | MailboxRepositoryError
) =>
  error instanceof MailboxDomainError && error.reason === "not-found"
    ? htmlError("not-found")
    : htmlError("storage", error);

const removedElements = new Set([
  "base",
  "embed",
  "frame",
  "frameset",
  "iframe",
  "meta",
  "object",
  "script",
]);
const removedAttributes = new Set([
  "action",
  "background",
  "cite",
  "data-preview-access-failure",
  "data-preview-status",
  "download",
  "formaction",
  "href",
  "longdesc",
  "lowsrc",
  "ping",
  "poster",
  "referrerpolicy",
  "rel",
  "src",
  "srcdoc",
  "srcset",
  "target",
  "xlink:href",
]);

interface SandboxedMessageHtmlOptions {
  readonly cidUrlByContentId?: ReadonlyMap<string, string>;
}

const normalizedCidReference = (value: string) => {
  if (!value.trimStart().toLowerCase().startsWith("cid:")) {
    return null;
  }
  try {
    return decodeURIComponent(value.trim().slice(4)).replaceAll(/^<|>$/gu, "");
  } catch {
    return null;
  }
};

const safeLinkHref = (value: string) => {
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" ||
      url.protocol === "http:" ||
      url.protocol === "mailto:"
    ) {
      return url.href;
    }
    return null;
  } catch {
    return null;
  }
};

const neutralizeNode = (
  node: DefaultTreeAdapterTypes.ParentNode,
  options: SandboxedMessageHtmlOptions
): void => {
  node.childNodes = node.childNodes.filter((child) => {
    if (!("tagName" in child)) {
      return true;
    }
    return !removedElements.has(child.tagName.toLowerCase());
  });

  for (const child of node.childNodes) {
    if (!("tagName" in child)) {
      continue;
    }
    const tagName = child.tagName.toLowerCase();
    const href = child.attrs.find(
      (attribute) => attribute.name.toLowerCase() === "href"
    )?.value;
    const src = child.attrs.find(
      (attribute) => attribute.name.toLowerCase() === "src"
    )?.value;
    child.attrs = child.attrs.filter((attribute) => {
      const name = attribute.name.toLowerCase();
      return !name.startsWith("on") && !removedAttributes.has(name);
    });
    if (tagName === "a" && href !== undefined) {
      const safeHref = safeLinkHref(href);
      if (safeHref !== null) {
        child.attrs.push(
          { name: "href", value: safeHref },
          { name: "target", value: "_blank" },
          { name: "rel", value: "noopener noreferrer nofollow" },
          { name: "referrerpolicy", value: "no-referrer" }
        );
      }
    }
    if (tagName === "img" && src !== undefined) {
      const contentId = normalizedCidReference(src);
      const cidUrl =
        contentId === null
          ? undefined
          : options.cidUrlByContentId?.get(contentId);
      if (cidUrl !== undefined) {
        child.attrs.push({ name: "src", value: cidUrl });
      }
    }
    neutralizeNode(child, options);
    if (child.tagName === "template" && "content" in child) {
      neutralizeNode(child.content, options);
    }
  }
};

export const renderSandboxedMessageHtml = (
  html: string,
  options: SandboxedMessageHtmlOptions = {}
) => {
  const document = parse(html);
  neutralizeNode(document, options);
  return Schema.decodeUnknownSync(SandboxedMessageHtmlDocument)(
    serialize(document)
  );
};

const inlineAttachmentPath = (
  input: MailboxMessageHtmlInput,
  attachmentId: string
) => {
  const query = new URLSearchParams();
  if (input._tag === "Folder") {
    query.set("folder", input.folderId);
  } else {
    query.set("label", input.labelId);
  }
  return `/api/mailboxes/${encodeURIComponent(input.mailboxId)}/messages/${encodeURIComponent(input.messageId)}/attachments/${encodeURIComponent(attachmentId)}/inline?${query.toString()}`;
};

const cidUrls = (
  input: MailboxMessageHtmlInput,
  attachments: readonly {
    readonly contentId?: string;
    readonly disposition: "attachment" | "inline";
    readonly id: string;
    readonly mimeType: string;
  }[]
) => {
  const matches = new Map<
    string,
    { readonly count: number; readonly url?: string }
  >();
  for (const attachment of attachments) {
    if (attachment.contentId === undefined) {
      continue;
    }
    const previous = matches.get(attachment.contentId);
    matches.set(
      attachment.contentId,
      previous === undefined
        ? {
            count: 1,
            url:
              attachment.disposition === "inline" &&
              isSafeInlineImageMimeType(attachment.mimeType)
                ? inlineAttachmentPath(input, attachment.id)
                : undefined,
          }
        : { count: previous.count + 1 }
    );
  }
  return new Map(
    [...matches].flatMap(([contentId, match]) =>
      match.count === 1 && match.url !== undefined
        ? [[contentId, match.url] as const]
        : []
    )
  );
};

/** Independently authorized HTML reads produce inert documents for one iframe. */
export class MailboxMessageHtmlReading extends Context.Service<
  MailboxMessageHtmlReading,
  MailboxMessageHtmlReadingService
>()("cloudflare-inbox/MailboxMessageHtmlReading", {
  make: Effect.gen(function* () {
    const authorization = yield* MailboxAuthorization;
    const repository = yield* MailboxMessageRepository;

    return {
      get: (input) =>
        Effect.gen(function* () {
          yield* input._tag === "Folder"
            ? authorization.requireFolderMessageRead({
                resource: {
                  _tag: "Folder",
                  folderId: input.folderId,
                  mailboxId: input.mailboxId,
                },
              })
            : authorization.requireMailboxMessageRead({
                resource: { _tag: "Mailbox", mailboxId: input.mailboxId },
              });

          const messageAccess = authorization.requireMessage({
            action: "read",
            resource: {
              _tag: "Message",
              mailboxId: input.mailboxId,
              messageId: input.messageId,
            },
          });
          const location = yield* input._tag === "Folder"
            ? messageAccess.pipe(
                Effect.catchTag("AuthorizationError", () =>
                  Effect.fail(htmlError("not-found"))
                )
              )
            : messageAccess;
          const message = yield* repository
            .getMessage({
              mailboxId: input.mailboxId,
              messageId: input.messageId,
            })
            .pipe(Effect.mapError(mapRepositoryError));
          const belongsToView =
            message.mailboxId === input.mailboxId &&
            message.id === input.messageId &&
            (input._tag === "Folder"
              ? location.folderId === input.folderId &&
                message.folderId === input.folderId
              : message.labelIds.includes(input.labelId));
          const { htmlBody } = message;
          if (!belongsToView || htmlBody === undefined) {
            return yield* htmlError("not-found");
          }

          const document = yield* Effect.try({
            try: () =>
              renderSandboxedMessageHtml(htmlBody, {
                cidUrlByContentId: cidUrls(input, message.attachments),
              }),
            catch: (cause) => htmlError("storage", cause),
          });
          return yield* Schema.decodeUnknownEffect(MailboxMessageHtmlResult)({
            ...input,
            document,
          }).pipe(Effect.mapError((cause) => htmlError("storage", cause)));
        }),
    } satisfies MailboxMessageHtmlReadingService;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
