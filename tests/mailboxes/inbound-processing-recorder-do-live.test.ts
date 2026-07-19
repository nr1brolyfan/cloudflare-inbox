import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import type { MailboxDoStub } from "#/mailboxes/do-client";
import { MailboxDoNamespace } from "#/mailboxes/do-client";
import { MailboxRepositoryError } from "#/mailboxes/errors";
import {
  InboundProcessingRecorder,
  RecordInboundProcessingV1,
} from "#/mailboxes/inbound";
import { InboundProcessingRecorderDoLive } from "#/mailboxes/inbound-processing-recorder-do-live";

const input = Schema.decodeUnknownSync(RecordInboundProcessingV1)({
  _tag: "Checkpoint",
  envelope: {
    envelopeFrom: "sender@example.test",
    envelopeTo: "owner@example.test",
    rawSize: 3,
  },
  formatVersion: 1,
  inboundIngestId: "ingest-1",
  mailboxId: "primary",
  receivedAt: 2000,
  status: "raw_stored",
});

const runRecord = (executeMailData: MailboxDoStub["executeMailData"]) =>
  Effect.runPromise(
    InboundProcessingRecorder.pipe(
      Effect.flatMap((recorder) => recorder.record(input)),
      Effect.provide(
        InboundProcessingRecorderDoLive.pipe(
          Layer.provide(
            Layer.succeed(
              MailboxDoNamespace,
              MailboxDoNamespace.of({
                getByName: () => ({
                  executeDirectory: () =>
                    Effect.die("executeDirectory must not run"),
                  executeMailData,
                  resolveMailResource: () =>
                    Effect.die("resolveMailResource must not run"),
                }),
              })
            )
          )
        )
      )
    )
  );

describe("inbound processing recorder DO adapter", () => {
  it("encodes a checkpoint and accepts a correlated advanced state", async () => {
    let request: unknown;

    const result = await runRecord((rpcInput) => {
      request = rpcInput;
      return Effect.succeed({
        _tag: "InboundProcessingRecorded",
        value: {
          attemptCount: 1,
          createdAt: 2000,
          id: "ingest-1",
          mailboxId: "primary",
          status: "attachments_stored",
          updatedAt: 2000,
          version: 3,
        },
      });
    });

    expect({ request, result }).toMatchObject({
      request: { _tag: "RecordInboundProcessing", input },
      result: {
        id: "ingest-1",
        status: "attachments_stored",
        version: 3,
      },
    });
  });

  it.each([
    ["transport failure", () => Effect.fail(new Error("unavailable")), true],
    ["invalid response", () => Effect.succeed({ nope: true }), false],
    [
      "regressed checkpoint",
      () =>
        Effect.succeed({
          _tag: "InboundProcessingRecorded",
          value: {
            attemptCount: 1,
            createdAt: 2000,
            id: "ingest-1",
            mailboxId: "primary",
            status: "received",
            updatedAt: 2000,
            version: 1,
          },
        }),
      false,
    ],
    [
      "unrelated response",
      () =>
        Effect.succeed({
          _tag: "InboundProcessingRecorded",
          value: {
            attemptCount: 1,
            createdAt: 2000,
            id: "other-ingest",
            mailboxId: "primary",
            status: "raw_stored",
            updatedAt: 2000,
            version: 1,
          },
        }),
      false,
    ],
  ] as const)(
    "maps %s with the expected retryability",
    async (_, rpc, retryable) => {
      const failure = await runRecord(rpc).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(MailboxRepositoryError);
      expect(failure).toMatchObject({ operation: "write", retryable });
    }
  );
});
