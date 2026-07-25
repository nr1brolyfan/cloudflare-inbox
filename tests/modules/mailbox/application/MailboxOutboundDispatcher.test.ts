import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  MailboxEmailSendClient,
  OutboundEmailProviderCloudflareLayer,
} from "#/modules/mailbox/adapters/email/OutboundEmailProviderCloudflare";
import { MailboxOutboundDispatcher } from "#/modules/mailbox/application/MailboxOutboundDispatcher";
import type { MailboxOutboundDispatcherService } from "#/modules/mailbox/application/MailboxOutboundDispatcher";
import { MailboxOperationalStatus } from "#/modules/mailbox/ports/MailboxOperationalStatus";
import {
  MailboxOutboundDispatchStore,
  OutboundDispatchSnapshotSchema,
} from "#/modules/mailbox/ports/MailboxOutboundDispatchStore";
import { OutboundDraftAttachmentBlobReader } from "#/modules/mailbox/ports/OutboundDraftAttachmentBlobReader";
import {
  DeliveryTemporaryFailureError,
  OutboundEmailProvider,
  OutboundProviderAcceptance,
} from "#/modules/mailbox/ports/OutboundEmailProvider";
import type { OutboundEmailProviderService } from "#/modules/mailbox/ports/OutboundEmailProvider";

const digest = "a".repeat(64);
const snapshot = Schema.decodeUnknownSync(OutboundDispatchSnapshotSchema)({
  attachments: [
    {
      attachmentId: "message-attachment-1",
      disposition: "attachment",
      fileName: "note.txt",
      location: {
        contentSha256: digest,
        draftAttachmentId: "draft-attachment-1",
        mailboxId: "mailbox-a",
        mimeType: "text/plain",
        size: 3,
      },
    },
  ],
  bcc: [{ address: "bcc@example.com" }],
  cc: [{ address: "cc@example.com" }],
  mailboxId: "mailbox-a",
  messageId: "message-1",
  outboundDeliveryId: "delivery-1",
  sender: { address: "sender@example.com", displayName: "Sender" },
  subject: "Hello",
  threading: {
    inReplyTo: "<parent@example.com>",
    references: ["<root@example.com>", "<parent@example.com>"],
  },
  to: [{ address: "to@example.com" }],
});

const runDispatch = (
  provider: OutboundEmailProviderService,
  counters: { attachmentReads: number; loads: number },
  isActive = true
) =>
  Effect.runPromise(
    MailboxOutboundDispatcher.pipe(
      Effect.flatMap((dispatcher: MailboxOutboundDispatcherService) =>
        dispatcher.dispatch(snapshot.outboundDeliveryId)
      ),
      Effect.provide(
        MailboxOutboundDispatcher.layerNoDeps.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                MailboxOutboundDispatchStore,
                MailboxOutboundDispatchStore.of({
                  load: () => {
                    counters.loads += 1;
                    return Effect.succeed(snapshot);
                  },
                })
              ),
              Layer.succeed(
                OutboundDraftAttachmentBlobReader,
                OutboundDraftAttachmentBlobReader.of({
                  read: () => {
                    counters.attachmentReads += 1;
                    return Effect.succeed(new Uint8Array([1, 2, 3]));
                  },
                })
              ),
              Layer.succeed(OutboundEmailProvider, provider),
              Layer.succeed(
                MailboxOperationalStatus,
                MailboxOperationalStatus.of({
                  acquire: () => Effect.succeed(isActive ? "holder-a" : null),
                  isActive: () => Effect.succeed(isActive),
                  release: () => Effect.void,
                })
              )
            )
          )
        )
      )
    )
  );

describe("mailbox outbound dispatcher", () => {
  it("rechecks lifecycle before reading attachments or calling the provider", async () => {
    const counters = { attachmentReads: 0, loads: 0 };
    let sends = 0;
    await expect(
      runDispatch(
        {
          send: () => {
            sends += 1;
            return Effect.die("provider must not run");
          },
        },
        counters,
        false
      )
    ).rejects.toMatchObject({ _tag: "MailboxOperationalStatusError" });
    expect({ ...counters, sends }).toStrictEqual({
      attachmentReads: 0,
      loads: 1,
      sends: 0,
    });
  });

  it("loads once, reads attachments, normalizes an absent body, and sends once", async () => {
    const counters = { attachmentReads: 0, loads: 0 };
    let sends = 0;
    let sentMessage: unknown;
    const acceptance = Schema.decodeUnknownSync(OutboundProviderAcceptance)({
      providerMessageId: "provider-message-1",
    });
    const result = await runDispatch(
      OutboundEmailProvider.of({
        send: (message) => {
          sends += 1;
          sentMessage = message;
          return Effect.succeed(acceptance);
        },
      }),
      counters
    );

    expect({ ...counters, sends }).toStrictEqual({
      attachmentReads: 1,
      loads: 1,
      sends: 1,
    });
    expect(sentMessage).toMatchObject({
      attachments: [
        {
          content: new Uint8Array([1, 2, 3]),
          disposition: "attachment",
          fileName: "note.txt",
          mimeType: "text/plain",
        },
      ],
      bcc: [{ address: "bcc@example.com" }],
      cc: [{ address: "cc@example.com" }],
      sender: { address: "sender@example.com", displayName: "Sender" },
      subject: "Hello",
      text: "",
      threading: {
        inReplyTo: "<parent@example.com>",
        references: ["<root@example.com>", "<parent@example.com>"],
      },
      to: [{ address: "to@example.com" }],
    });
    expect(result).toBe(acceptance);
  });

  it("propagates provider failures after exactly one attempt", async () => {
    const counters = { attachmentReads: 0, loads: 0 };
    let sends = 0;
    const providerFailure = new DeliveryTemporaryFailureError({
      cause: new Error("rate limited"),
      message: "Temporary provider failure",
    });
    const failure = await runDispatch(
      OutboundEmailProvider.of({
        send: () => {
          sends += 1;
          return Effect.fail(providerFailure);
        },
      }),
      counters
    ).catch((error: unknown) => error);

    expect({ ...counters, sends }).toStrictEqual({
      attachmentReads: 1,
      loads: 1,
      sends: 1,
    });
    expect(failure).toBe(providerFailure);
  });

  it("defends at the full dispatch/provider boundary when actual bytes exceed snapshot metadata", async () => {
    let attachmentReads = 0;
    let clientSends = 0;
    const providerLayer = OutboundEmailProviderCloudflareLayer.pipe(
      Layer.provide(
        Layer.succeed(
          MailboxEmailSendClient,
          MailboxEmailSendClient.of({
            send: () => {
              clientSends += 1;
              return Effect.succeed({ messageId: "provider-message-1" });
            },
          })
        )
      )
    );
    const error = await Effect.runPromise(
      MailboxOutboundDispatcher.pipe(
        Effect.flatMap((dispatcher) =>
          dispatcher.dispatch(snapshot.outboundDeliveryId)
        ),
        Effect.flip,
        Effect.provide(
          MailboxOutboundDispatcher.layerNoDeps.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(
                  MailboxOutboundDispatchStore,
                  MailboxOutboundDispatchStore.of({
                    load: () => Effect.succeed(snapshot),
                  })
                ),
                Layer.succeed(
                  OutboundDraftAttachmentBlobReader,
                  OutboundDraftAttachmentBlobReader.of({
                    read: () => {
                      attachmentReads += 1;
                      // Production R2 reading rejects this size drift first. The
                      // synthetic seam proves the provider remains fail-closed.
                      return Effect.succeed(new Uint8Array(5 * 1024 * 1024));
                    },
                  })
                ),
                providerLayer,
                Layer.succeed(
                  MailboxOperationalStatus,
                  MailboxOperationalStatus.of({
                    acquire: () => Effect.succeed("holder-a"),
                    isActive: () => Effect.succeed(true),
                    release: () => Effect.void,
                  })
                )
              )
            )
          )
        )
      )
    );

    expect(error).toMatchObject({
      _tag: "DeliveryRejectedError",
      reason: "message-too-large",
    });
    expect({ attachmentReads, clientSends }).toStrictEqual({
      attachmentReads: 1,
      clientSends: 0,
    });
  });
});
