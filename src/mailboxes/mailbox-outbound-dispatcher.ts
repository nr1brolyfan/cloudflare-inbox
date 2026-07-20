import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { OutboundDeliveryId } from "./core";
import type { BlobStoreError } from "./errors";
import { MailboxOutboundDispatchStore } from "./outbound-dispatch-snapshot";
import type { OutboundDispatchSnapshotError } from "./outbound-dispatch-snapshot";
import { MailboxOutboundDispatchStoreSqliteLive } from "./outbound-dispatch-store-sqlite-live";
import {
  OutboundDraftAttachmentBlobReader,
  OutboundDraftAttachmentBlobReaderR2WithRuntimeLive,
} from "./outbound-draft-attachment-reader-r2-live";
import type {
  OutboundEmailProviderError,
  OutboundProviderAcceptance,
} from "./outbound-email-provider";
import { OutboundEmailProvider } from "./outbound-email-provider";

export type MailboxOutboundDispatcherError =
  | BlobStoreError
  | OutboundDispatchSnapshotError
  | OutboundEmailProviderError;

export interface MailboxOutboundDispatcher {
  readonly dispatch: (
    outboundDeliveryId: OutboundDeliveryId
  ) => Effect.Effect<
    OutboundProviderAcceptance,
    MailboxOutboundDispatcherError
  >;
}

export const MailboxOutboundDispatcher =
  Context.Service<MailboxOutboundDispatcher>(
    "cloudflare-inbox/MailboxOutboundDispatcher"
  );

export const MailboxOutboundDispatcherLive = Layer.effect(
  MailboxOutboundDispatcher,
  Effect.gen(function* () {
    const store = yield* MailboxOutboundDispatchStore;
    const attachmentReader = yield* OutboundDraftAttachmentBlobReader;
    const provider = yield* OutboundEmailProvider;

    return MailboxOutboundDispatcher.of({
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
    });
  })
);

/** SQLite snapshot and verified R2 reader; callers provide DO-local clients and provider. */
export const MailboxOutboundDispatcherWithStorageLive =
  MailboxOutboundDispatcherLive.pipe(
    Layer.provide(
      Layer.merge(
        MailboxOutboundDispatchStoreSqliteLive,
        OutboundDraftAttachmentBlobReaderR2WithRuntimeLive
      )
    )
  );
