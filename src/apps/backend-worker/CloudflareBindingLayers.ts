import type { AlchemyRateLimitDurableObjectNamespace } from "@effect-auth/core/AlchemyCloudflareRateLimitDurableObject";
import { RuntimeContext } from "alchemy";
import type * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { MailboxDONamespace } from "#/apps/mailbox-do/MailboxDO";
import { MailboxDoNamespace } from "#/modules/mailbox/adapters/durable-object/MailboxDoClient";
import {
  MailboxEmailSendBindingClient,
  MailboxEmailSendClientCloudflareLayer,
  OutboundEmailProviderCloudflareLayer,
} from "#/modules/mailbox/adapters/email/OutboundEmailProviderCloudflare";
import { OutboundEmailProviderUnavailableLayer } from "#/modules/mailbox/adapters/email/OutboundEmailProviderUnavailable";
import { DraftAttachmentR2Client } from "#/modules/mailbox/adapters/r2/DraftAttachmentBlobStoreR2";
import type { DraftAttachmentR2Object } from "#/modules/mailbox/adapters/r2/DraftAttachmentBlobStoreR2";
import { InboundAttachmentR2ReadClient } from "#/modules/mailbox/adapters/r2/InboundAttachmentBlobReaderR2";
import { InboundRawMessageR2WriteClient } from "#/modules/mailbox/adapters/r2/InboundRawMessageStoreR2";
import { OutboundDraftAttachmentR2ReadClient } from "#/modules/mailbox/adapters/r2/OutboundDraftAttachmentBlobReaderR2";
import { InboundWorkflowClient } from "#/modules/mailbox/adapters/workflow/InboundWorkflowStarterCloudflare";

import { BackendHealthBindings } from "./BackendHealthLayer";

export type RawMessagesR2Binding = Effect.Success<
  ReturnType<typeof Cloudflare.R2.ReadWriteBucket>
>;

interface InboundWorkflowBinding {
  readonly create: InboundWorkflowClient["create"];
  readonly get: InboundWorkflowClient["get"];
}

const checksumHex = (value: ArrayBuffer) =>
  [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

// Normalizes Alchemy's R2 object shape once for attachment adapters.
const attachmentObject = (object: {
  readonly checksums: { readonly sha256?: ArrayBuffer };
  readonly customMetadata?: Record<string, string>;
  readonly httpMetadata?: { readonly contentType?: string };
  readonly size: number;
}): DraftAttachmentR2Object => ({
  contentType: object.httpMetadata?.contentType,
  customMetadata: object.customMetadata ?? {},
  sha256:
    object.checksums.sha256 === undefined
      ? undefined
      : checksumHex(object.checksums.sha256),
  size: object.size,
});

/** Adapts the acquired Workflow binding without hiding its runtime identity. */
export const inboundWorkflowClientLayer = (binding: InboundWorkflowBinding) =>
  Layer.succeed(
    InboundWorkflowClient,
    InboundWorkflowClient.of({
      create: (options) => binding.create(options),
      get: (instanceId) => binding.get(instanceId),
    })
  );

/** Adapts RawMessages writes used by email ingress. */
export const inboundRawMessageR2WriteClientLayer = (
  binding: RawMessagesR2Binding
) =>
  Layer.succeed(
    InboundRawMessageR2WriteClient,
    InboundRawMessageR2WriteClient.of({
      put: (key, value, options) =>
        binding
          .put(key, value as unknown as ReadableStream, options)
          .pipe(Effect.provide(RuntimeContext.phantom)),
    })
  );

/** Adapts RawMessages reads used by inbound attachment retrieval. */
export const inboundAttachmentR2ReadClientLayer = (
  binding: RawMessagesR2Binding
) =>
  Layer.succeed(
    InboundAttachmentR2ReadClient,
    InboundAttachmentR2ReadClient.of({
      get: (key) =>
        binding.get(key).pipe(
          Effect.provide(RuntimeContext.phantom),
          Effect.map((object) =>
            object === null
              ? null
              : { ...attachmentObject(object), arrayBuffer: object.arrayBuffer }
          )
        ),
    })
  );

/** Adapts RawMessages metadata and writes used by draft attachments. */
export const draftAttachmentR2ClientLayer = (binding: RawMessagesR2Binding) =>
  Layer.succeed(
    DraftAttachmentR2Client,
    DraftAttachmentR2Client.of({
      head: (key) =>
        binding.head(key).pipe(
          Effect.provide(RuntimeContext.phantom),
          Effect.map((object) =>
            object === null ? null : attachmentObject(object)
          )
        ),
      put: (key, content, options) =>
        binding.put(key, content, options).pipe(
          Effect.provide(RuntimeContext.phantom),
          Effect.map((object) =>
            object === null ? null : attachmentObject(object)
          )
        ),
    })
  );

/** Adapts RawMessages reads used while dispatching frozen drafts. */
export const outboundDraftAttachmentR2ReadClientLayer = (
  binding: RawMessagesR2Binding
) =>
  Layer.succeed(
    OutboundDraftAttachmentR2ReadClient,
    OutboundDraftAttachmentR2ReadClient.of({
      get: (key) =>
        binding.get(key).pipe(
          Effect.provide(RuntimeContext.phantom),
          Effect.map((object) =>
            object === null
              ? null
              : { ...attachmentObject(object), arrayBuffer: object.arrayBuffer }
          )
        ),
    })
  );

/** Exposes the acquired mailbox Durable Object namespace to its adapters. */
export const mailboxDoNamespaceLayer = (binding: MailboxDONamespace) =>
  Layer.succeed(MailboxDoNamespace, MailboxDoNamespace.of(binding));

/** Keeps readiness-only bindings separate from application dependencies. */
export const backendHealthBindingsLayer = (bindings: {
  readonly authRateLimit: AlchemyRateLimitDurableObjectNamespace;
  readonly mailboxDataPlane: MailboxDONamespace;
  readonly rawMessages: RawMessagesR2Binding;
}) => Layer.succeed(BackendHealthBindings, BackendHealthBindings.of(bindings));

/** Selects a fully wired outbound provider from the optional production binding. */
export const mailboxOutboundProviderLayer = (
  binding?: Cloudflare.Email.SendClient
) => {
  if (binding === undefined) {
    return OutboundEmailProviderUnavailableLayer;
  }

  return OutboundEmailProviderCloudflareLayer.pipe(
    Layer.provide(MailboxEmailSendClientCloudflareLayer),
    Layer.provide(Layer.succeed(MailboxEmailSendBindingClient, binding))
  );
};
