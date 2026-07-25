import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { OutboundDeliveryId } from "#/modules/mailbox/domain/Mailbox";
import { effectiveOutboundBcc } from "#/modules/mailbox/domain/MailboxOutbound";
import type { BlobStoreError } from "#/modules/mailbox/ports/MailboxBlobStore";
import {
  MailboxOperationalStatus,
  MailboxOperationalStatusError,
} from "#/modules/mailbox/ports/MailboxOperationalStatus";
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
  | MailboxOperationalStatusError
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
    const operationalStatus = yield* MailboxOperationalStatus;

    return {
      dispatch: (outboundDeliveryId) =>
        Effect.gen(function* () {
          const snapshot = yield* store.load(outboundDeliveryId);
          const fence = {
            mailboxId: snapshot.mailboxId,
            operationId: snapshot.outboundDeliveryId,
            operationKind: "outbound-dispatch" as const,
          };
          const acquired = yield* operationalStatus.acquire(fence);
          if (!acquired) {
            return yield* new MailboxOperationalStatusError({
              message: "Mailbox or organization is suspended",
            });
          }
          return yield* Effect.gen(function* () {
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
            const bcc = effectiveOutboundBcc(
              snapshot.to,
              snapshot.cc,
              snapshot.bcc,
              snapshot.archiveRecipient
            );

            return yield* provider.send({
              attachments,
              bcc,
              cc: snapshot.cc,
              ...(snapshot.html === undefined ? {} : { html: snapshot.html }),
              sender: snapshot.sender,
              subject: snapshot.subject,
              ...(snapshot.text === undefined
                ? noBody
                  ? { text: "" }
                  : {}
                : { text: snapshot.text }),
              ...(snapshot.threading === undefined
                ? {}
                : { threading: snapshot.threading }),
              to: snapshot.to,
            });
          }).pipe(
            Effect.ensuring(
              operationalStatus
                .release({ ...fence, holderId: acquired })
                .pipe(Effect.orDie)
            )
          );
        }),
    } satisfies MailboxOutboundDispatcherService;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
