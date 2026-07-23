import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import type { MailboxDoStub } from "#/mailboxes/do-client";
import { MailboxDoNamespace } from "#/mailboxes/do-client";
import {
  CommitInboundMessageV1,
  InboundMessageCommitter,
} from "#/mailboxes/inbound";
import { InboundMessageCommitterDoLive } from "#/mailboxes/inbound-message-committer-do-live";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";

const input = Schema.decodeUnknownSync(CommitInboundMessageV1)({
  envelope: {
    envelopeFrom: "sender@example.test",
    envelopeTo: "owner@example.test",
    rawSize: 3,
  },
  formatVersion: 1,
  inboundIngestId: "ingest-1",
  mailboxId: "primary",
  message: {
    attachments: [],
    bcc: [],
    cc: [],
    formatVersion: 1,
    references: [],
    subject: "Hello",
    to: [{ address: "owner@example.test" }],
  },
  receivedAt: 2000,
});

const stub = (
  executeMailData: MailboxDoStub["executeMailData"]
): MailboxDoStub => ({
  executeDirectory: () => Effect.die("executeDirectory must not run"),
  executeMailData,
  resolveMailResource: () => Effect.die("resolveMailResource must not run"),
});

const runCommit = (
  executeMailData: MailboxDoStub["executeMailData"],
  onName?: (name: string) => void
) =>
  Effect.runPromise(
    InboundMessageCommitter.pipe(
      Effect.flatMap((committer) => committer.commit(input)),
      Effect.provide(
        InboundMessageCommitterDoLive.pipe(
          Layer.provide(
            Layer.succeed(
              MailboxDoNamespace,
              MailboxDoNamespace.of({
                getByName: (name) => {
                  onName?.(name);
                  return stub(executeMailData);
                },
              })
            )
          )
        )
      )
    )
  );

describe("inbound message committer DO adapter", () => {
  it("targets the canonical mailbox and decodes a ready result", async () => {
    let target: string | undefined;
    let request: unknown;

    const result = await runCommit(
      (rpcInput) => {
        request = rpcInput;
        return Effect.succeed({
          _tag: "InboundCommitted",
          value: {
            attemptCount: 1,
            createdAt: 2000,
            id: "ingest-1",
            mailboxId: "primary",
            messageId: "message-1",
            status: "ready",
            updatedAt: 2000,
            version: 1,
          },
        });
      },
      (name) => {
        target = name;
      }
    );

    expect({ request, result, target }).toMatchObject({
      request: { _tag: "CommitInbound", input },
      result: {
        id: "ingest-1",
        messageId: "message-1",
        status: "ready",
      },
      target: "primary",
    });
  });

  it("reconstructs a domain conflict", async () => {
    const failure = await runCommit(() =>
      Effect.succeed({
        _tag: "DomainError",
        message: "Conflict",
        operation: "commit-inbound",
        reason: "idempotency-conflict",
        resourceId: "ingest-1",
        resourceType: "inbound",
      })
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MailboxDomainError);
    expect(failure).toMatchObject({
      operation: "commit-inbound",
      reason: "idempotency-conflict",
      resourceId: "ingest-1",
    });
  });

  it.each([
    ["transport failure", () => Effect.fail(new Error("unavailable"))],
    ["transport defect", () => Effect.die(new Error("defect"))],
    [
      "synchronous transport throw",
      () => {
        throw new Error("synchronous defect");
      },
    ],
    ["invalid response", () => Effect.succeed({ nope: true })],
    [
      "wrong response",
      () => Effect.succeed({ _tag: "MessagesListed", value: { items: [] } }),
    ],
    [
      "unrelated result",
      () =>
        Effect.succeed({
          _tag: "InboundCommitted",
          value: {
            attemptCount: 1,
            createdAt: 2000,
            id: "other-ingest",
            mailboxId: "primary",
            messageId: "message-1",
            status: "ready",
            updatedAt: 2000,
            version: 1,
          },
        }),
    ],
  ] as const)(
    "maps %s to an unknown-commit repository error",
    async (_, rpc) => {
      const failure = await runCommit(rpc).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(MailboxRepositoryError);
      expect(failure).toMatchObject({
        commitState: "unknown",
        operation: "write",
      });
    }
  );
});
