import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { OutboundDeliveryId } from "#/modules/mailbox/domain/Mailbox";
import type { BlobStoreError } from "#/modules/mailbox/ports/MailboxBlobStore";
import { MailboxOutboundDispatchStore } from "#/modules/mailbox/ports/MailboxOutboundDispatchStore";
import type { OutboundDispatchSnapshotError } from "#/modules/mailbox/ports/MailboxOutboundDispatchStore";
import { OutboundDraftAttachmentBlobReader } from "#/modules/mailbox/ports/OutboundDraftAttachmentBlobReader";
import { OutboundEmailProvider } from "#/modules/mailbox/ports/OutboundEmailProvider";
import type {
  OutboundEmailProviderError,
  OutboundProviderAcceptance,
} from "#/modules/mailbox/ports/OutboundEmailProvider";

export type MailboxOutboundDispatcherError =
  | BlobStoreError
  | OutboundDispatchSnapshotError
  | OutboundEmailProviderError;

export interface MailboxOutboundDispatcherService {
  readonly dispatch: (
    outboundDeliveryId: OutboundDeliveryId
  ) => Effect.Effect<
    OutboundProviderAcceptance,
    MailboxOutboundDispatcherError
  >;
}

export class MailboxOutboundDispatcher extends Context.Service<
  MailboxOutboundDispatcher,
  MailboxOutboundDispatcherService
>()("cloudflare-inbox/MailboxOutboundDispatcher", {
  make: Effect.gen(function* () {
    const store = yield* MailboxOutboundDispatchStore;
    const attachmentReader = yield* OutboundDraftAttachmentBlobReader;
    const provider = yield* OutboundEmailProvider;

    return {
      dispatch: (outboundDeliveryId) =>
        Effect.gen(function* () {
          const snapshot = yield* store.load(outboundDeliveryId);
          const attachments = yield* Effect.all(
            snapshot.attachments.map((attachment) =>
              attachmentReader.read(attachment.location).pipe(
                Effect.map((content) => ({
                  content,
                  contentId: attachment.contentId,
                  disposition: attachment.disposition,
                  fileName: attachment.fileName,
                  mimeType: attachment.location.mimeType,
                }))
              )
            ),
            { concurrency: 1 }
          );
          const noBody =
            snapshot.text === undefined && snapshot.html === undefined;

          return yield* provider.send({
            attachments,
            bcc: snapshot.bcc,
            cc: snapshot.cc,
            ...(snapshot.html === undefined ? {} : { html: snapshot.html }),
            sender: snapshot.sender,
            subject: snapshot.subject,
            ...(snapshot.text === undefined
              ? noBody
                ? { text: "" }
                : {}
              : { text: snapshot.text }),
            to: snapshot.to,
          });
        }),
    } satisfies MailboxOutboundDispatcherService;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
