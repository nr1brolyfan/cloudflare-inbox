import type * as CloudflareWorkers from "@cloudflare/workers-types";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  handleCloudflareEmailRoutingMessage,
  MailboxInboundEmailIngressUnavailableLayer,
} from "#/apps/backend-worker/CloudflareEmailRoutingIntegration";
import { InboundMailboxResolver } from "#/modules/address-routing/ports/InboundMailboxResolver";
import type { InboundMailboxResolverService } from "#/modules/address-routing/ports/InboundMailboxResolver";
import type { InboundEmailRoutingMessage } from "#/modules/mailbox/application/MailboxInboundEmailIngress";
import { MailboxInboundEmailIngress } from "#/modules/mailbox/application/MailboxInboundEmailIngress";
import {
  MailboxArchiveConfig,
  MailboxArchiveConfigValue,
  MailboxArchiveRecipient,
} from "#/modules/mailbox/contracts/MailboxArchiveConfig";
import { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import { MAXIMUM_INBOUND_RAW_BYTES } from "#/modules/mailbox/domain/MailboxInbound";
import { InboundEmailRejected } from "#/modules/mailbox/ports/InboundEmailIngress";
import { InboundRawMessageStore } from "#/modules/mailbox/ports/InboundRawMessageStore";
import type { InboundRawMessageStoreService } from "#/modules/mailbox/ports/InboundRawMessageStore";
import { InboundWorkflowStarter } from "#/modules/mailbox/ports/InboundWorkflowStarter";
import type { InboundWorkflowStarterService } from "#/modules/mailbox/ports/InboundWorkflowStarter";
import { BlobStoreError } from "#/modules/mailbox/ports/MailboxBlobStore";
import { MailboxInboundEmailIngressRuntime } from "#/modules/mailbox/ports/MailboxInboundEmailIngressRuntime";
import { WorkflowStartError } from "#/modules/mailbox/ports/MailboxWorkflowStarter";

type ForwardableEmailMessage = CloudflareWorkers.ForwardableEmailMessage;
const primaryMailboxId = Schema.decodeUnknownSync(MailboxId)("primary");
const archiveRecipient = Schema.decodeUnknownSync(MailboxArchiveRecipient)(
  "private-archive@example.net"
);
const archiveConfig = new MailboxArchiveConfigValue({
  recipient: archiveRecipient,
});

const rawStream = () =>
  new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  }) as unknown as ForwardableEmailMessage["raw"];

const lazyRawStream = (onPull: () => void) =>
  new ReadableStream<Uint8Array>(
    {
      pull: () => {
        onPull();
        throw new Error("Raw stream must not be consumed during admission");
      },
    },
    { highWaterMark: 0 }
  ) as unknown as ForwardableEmailMessage["raw"];

const headers = (): ForwardableEmailMessage["headers"] => {
  const source = new Headers({ to: "header-recipient@example.com" });

  return Object.assign(source, {
    getAll: (name: string) => {
      const value = source.get(name);

      return value === null ? [] : [value];
    },
  }) as unknown as ForwardableEmailMessage["headers"];
};

const makeMessage = (
  overrides: Partial<ForwardableEmailMessage> = {}
): {
  readonly forwarded: readonly {
    readonly argumentCount: number;
    readonly headers: Headers | undefined;
    readonly recipient: string;
  }[];
  readonly message: ForwardableEmailMessage;
  readonly rejected: string[];
} => {
  const forwarded: {
    readonly argumentCount: number;
    readonly headers: Headers | undefined;
    readonly recipient: string;
  }[] = [];
  const rejected: string[] = [];
  const message: ForwardableEmailMessage = {
    forward: (...arguments_) => {
      const [recipient, forwardedHeaders] = arguments_;
      forwarded.push({
        argumentCount: arguments_.length,
        headers: forwardedHeaders,
        recipient,
      });
      return Promise.resolve({ messageId: "forwarded" });
    },
    from: "sender@example.com",
    headers: headers(),
    raw: rawStream(),
    rawSize: 3,
    reply: () => Promise.resolve({ messageId: "reply" }),
    setReject: (reason) => {
      rejected.push(reason);
    },
    to: "owner@example.com",
    ...overrides,
  };

  return { forwarded, message, rejected };
};

const runWithIngress = (
  message: ForwardableEmailMessage,
  receive: (
    message: InboundEmailRoutingMessage
  ) => Effect.Effect<void, InboundEmailRejected>,
  resolve: InboundMailboxResolverService["resolve"] = () =>
    Effect.succeed(primaryMailboxId)
) =>
  Effect.runPromise(
    handleCloudflareEmailRoutingMessage(message).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(
            MailboxInboundEmailIngress,
            MailboxInboundEmailIngress.of({ receive })
          ),
          Layer.succeed(
            InboundMailboxResolver,
            InboundMailboxResolver.of({ resolve })
          ),
          Layer.succeed(
            MailboxArchiveConfig,
            MailboxArchiveConfig.of(archiveConfig)
          )
        )
      )
    )
  );

const realIngressLayer = (
  store: InboundRawMessageStoreService["store"],
  start: InboundWorkflowStarterService["start"]
) =>
  MailboxInboundEmailIngress.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          InboundRawMessageStore,
          InboundRawMessageStore.of({ store })
        ),
        Layer.succeed(
          InboundWorkflowStarter,
          InboundWorkflowStarter.of({ start })
        ),
        Layer.succeed(
          MailboxInboundEmailIngressRuntime,
          MailboxInboundEmailIngressRuntime.of({
            now: () => 2000,
            randomId: () => "ingest-1",
          })
        )
      )
    )
  );

const runWithRealIngress = (
  message: ForwardableEmailMessage,
  store: InboundRawMessageStoreService["store"],
  start: InboundWorkflowStarterService["start"]
) =>
  Effect.runPromise(
    handleCloudflareEmailRoutingMessage(message).pipe(
      Effect.provide(
        Layer.mergeAll(
          realIngressLayer(store, start),
          Layer.succeed(
            InboundMailboxResolver,
            InboundMailboxResolver.of({
              resolve: () => Effect.succeed(primaryMailboxId),
            })
          ),
          Layer.succeed(
            MailboxArchiveConfig,
            MailboxArchiveConfig.of(archiveConfig)
          )
        )
      )
    )
  );

describe("Cloudflare Email Routing inbound adapter", () => {
  it("awaits successful app ingress before forwarding the original capability", async () => {
    const events: string[] = [];
    let settled = false;
    let forwarded:
      | { readonly headers: Headers | undefined; readonly recipient: string }
      | undefined;
    const ingressBarrier = Effect.runSync(Deferred.make<null>());
    const forwardBarrier = Effect.runSync(Deferred.make<null>());
    const ingressStarted = Effect.runSync(Deferred.make<null>());
    const forwardStarted = Effect.runSync(Deferred.make<null>());
    const { message, rejected } = makeMessage({
      forward(recipient, forwardedHeaders) {
        if (this !== message) {
          throw new Error(
            "Forward must retain the original message capability"
          );
        }
        forwarded = { headers: forwardedHeaders, recipient };
        events.push("forward");
        Effect.runSync(Deferred.succeed(forwardStarted, null));
        return Effect.runPromise(Deferred.await(forwardBarrier)).then(() => ({
          messageId: "forwarded",
        }));
      },
    });

    const handled = runWithIngress(message, () =>
      Effect.gen(function* () {
        events.push("ingress");
        yield* Deferred.succeed(ingressStarted, null);
        yield* Deferred.await(ingressBarrier);
      })
    ).then(() => {
      settled = true;
    });

    await Effect.runPromise(Deferred.await(ingressStarted));
    expect({ events, forwarded, settled }).toStrictEqual({
      events: ["ingress"],
      forwarded: undefined,
      settled: false,
    });
    Effect.runSync(Deferred.succeed(ingressBarrier, null));
    await Effect.runPromise(Deferred.await(forwardStarted));
    expect({ events, forwarded, settled }).toStrictEqual({
      events: ["ingress", "forward"],
      forwarded: { headers: undefined, recipient: archiveRecipient },
      settled: false,
    });
    Effect.runSync(Deferred.succeed(forwardBarrier, null));
    await handled;
    expect({ rejected, settled }).toStrictEqual({
      rejected: [],
      settled: true,
    });
  });

  it("forwards exactly once to the private recipient without headers", async () => {
    const { forwarded, message, rejected } = makeMessage();

    await runWithIngress(message, () => Effect.void);

    expect(forwarded).toStrictEqual([
      {
        argumentCount: 1,
        headers: undefined,
        recipient: archiveRecipient,
      },
    ]);
    expect(rejected).toStrictEqual([]);
  });

  it.each([
    [
      "synchronous throw",
      () => {
        throw new Error("private-archive@example.net message-id-secret");
      },
    ],
    [
      "rejected promise",
      () =>
        Promise.reject(
          new Error("private-archive@example.net message-id-secret")
        ),
    ],
  ])(
    "permanently rejects a %s with one forwarding attempt and no leaked values",
    async (_label, forward) => {
      let attempts = 0;
      const { message, rejected } = makeMessage({
        forward: ((recipient: string) => {
          attempts += 1;
          expect(recipient).toBe(archiveRecipient);
          return forward();
        }) as ForwardableEmailMessage["forward"],
      });

      await runWithIngress(message, () => Effect.void);

      expect({ attempts, rejected }).toStrictEqual({
        attempts: 1,
        rejected: ["Inbound email archive is not available"],
      });
      expect(JSON.stringify(rejected)).not.toMatch(
        /private-archive@example\.net|message-id-secret|leaked|secret/u
      );
    }
  );

  it.each([
    ["undefined", undefined],
    ["empty object", {}],
    ["empty message ID", { messageId: "" }],
    ["extra fields", { messageId: "forwarded", result: "ignored" }],
  ])(
    "accepts a resolved forward promise with an ignored %s result",
    async (_, result) => {
      const { message, rejected } = makeMessage({
        forward: (() =>
          Promise.resolve(result)) as ForwardableEmailMessage["forward"],
      });

      await runWithIngress(message, () => Effect.void);

      expect(rejected).toStrictEqual([]);
    }
  );

  it.each([
    [
      "own data false",
      (message: ForwardableEmailMessage) =>
        Object.assign(message, { canBeForwarded: false }),
      0,
    ],
    [
      "own data true",
      (message: ForwardableEmailMessage) =>
        Object.assign(message, { canBeForwarded: true }),
      1,
    ],
    [
      "inherited getter false",
      (message: ForwardableEmailMessage) =>
        Object.assign(
          Object.create({
            get canBeForwarded() {
              return false;
            },
          }) as object,
          message
        ) as ForwardableEmailMessage,
      0,
    ],
    [
      "inherited getter true",
      (message: ForwardableEmailMessage) =>
        Object.assign(
          Object.create({
            get canBeForwarded() {
              return true;
            },
          }) as object,
          message
        ) as ForwardableEmailMessage,
      1,
    ],
    [
      "own accessor false",
      (message: ForwardableEmailMessage) =>
        Object.defineProperty(message, "canBeForwarded", {
          get: () => false,
        }),
      0,
    ],
    [
      "throwing getter",
      (message: ForwardableEmailMessage) =>
        Object.defineProperty(message, "canBeForwarded", {
          get: () => {
            throw new Error("private canBeForwarded getter cause");
          },
        }),
      0,
    ],
    [
      "throwing proxy access",
      (message: ForwardableEmailMessage) =>
        new Proxy(Object.assign(message, { canBeForwarded: true }), {
          get: (target, property, receiver) => {
            if (property === "canBeForwarded") {
              throw new Error("private canBeForwarded proxy cause");
            }
            return Reflect.get(target, property, receiver);
          },
        }),
      0,
    ],
    [
      "malformed string",
      (message: ForwardableEmailMessage) =>
        Object.assign(message, { canBeForwarded: "false" }),
      0,
    ],
    [
      "present undefined",
      (message: ForwardableEmailMessage) =>
        Object.defineProperty(message, "canBeForwarded", { value: undefined }),
      0,
    ],
    [
      "absent legacy property",
      (message: ForwardableEmailMessage) => message,
      1,
    ],
  ] as const)(
    "handles %s before application side effects",
    async (_, decorate, expectedCalls) => {
      const calls = { forward: 0, receive: 0, resolve: 0 };
      const created = makeMessage({
        forward: () => {
          calls.forward += 1;
          return Promise.resolve({ messageId: "ignored" });
        },
      });
      const message = decorate(created.message);

      await runWithIngress(
        message,
        () =>
          Effect.sync(() => {
            calls.receive += 1;
          }),
        () =>
          Effect.sync(() => {
            calls.resolve += 1;
            return primaryMailboxId;
          })
      );

      expect({ calls, rejected: created.rejected }).toStrictEqual({
        calls: {
          forward: expectedCalls,
          receive: expectedCalls,
          resolve: expectedCalls,
        },
        rejected:
          expectedCalls === 0 ? ["Inbound email archive is not available"] : [],
      });
    }
  );

  it("composes real app ingress with fake R2 and Workflow ports in exact order", async () => {
    const events: string[] = [];
    const { message, rejected } = makeMessage({
      forward: () => {
        events.push("forward");
        return Promise.resolve({ messageId: "ignored" });
      },
    });

    await runWithRealIngress(
      message,
      () =>
        Effect.sync(() => {
          events.push("fake-r2-store-complete");
        }),
      () =>
        Effect.sync(() => {
          events.push("fake-workflow-confirmed");
        })
    );

    expect({ events, rejected }).toStrictEqual({
      events: ["fake-r2-store-complete", "fake-workflow-confirmed", "forward"],
      rejected: [],
    });
  });

  it.each(["raw-store", "workflow"] as const)(
    "suppresses forward after a real app ingress %s port failure",
    async (failureAt) => {
      const events: string[] = [];
      let forwards = 0;
      const { message, rejected } = makeMessage({
        forward: () => {
          forwards += 1;
          return Promise.resolve({ messageId: "must-not-forward" });
        },
      });

      await runWithRealIngress(
        message,
        () =>
          failureAt === "raw-store"
            ? Effect.fail(
                new BlobStoreError({
                  cause: new Error("fake R2 unavailable"),
                  message: "Fake R2 write failed",
                  objectType: "raw-message",
                  operation: "write",
                  retryable: true,
                })
              )
            : Effect.sync(() => {
                events.push("fake-r2-store-complete");
              }),
        (params) =>
          failureAt === "workflow"
            ? Effect.fail(
                new WorkflowStartError({
                  cause: new Error("fake Workflow unavailable"),
                  instanceId: params.inboundIngestId,
                  message: "Fake Workflow start failed",
                  workflow: "inbound",
                })
              )
            : Effect.void
      );

      expect({ events, forwards, rejected }).toStrictEqual({
        events: failureAt === "workflow" ? ["fake-r2-store-complete"] : [],
        forwards: 0,
        rejected: ["Inbound email processing is not available"],
      });
    }
  );

  it("emits only a bounded archive failure outcome with no logs or private errors", async () => {
    const logs: unknown[] = [];
    const logger = Logger.make((options) => {
      logs.push({
        cause: Cause.pretty(options.cause),
        message: options.message,
      });
    });
    const privateCause =
      "private-archive@example.net provider-result raw-message-secret";
    const { message, rejected } = makeMessage({
      forward: () => Promise.reject(new Error(privateCause)),
    });

    const span = await Effect.runPromise(
      Effect.gen(function* () {
        yield* handleCloudflareEmailRoutingMessage(message);
        return yield* Effect.currentSpan;
      }).pipe(
        Effect.withSpan("test.inbound-archive"),
        Effect.provide(Logger.layer([logger])),
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(
              MailboxInboundEmailIngress,
              MailboxInboundEmailIngress.of({ receive: () => Effect.void })
            ),
            Layer.succeed(
              InboundMailboxResolver,
              InboundMailboxResolver.of({
                resolve: () => Effect.succeed(primaryMailboxId),
              })
            ),
            Layer.succeed(
              MailboxArchiveConfig,
              MailboxArchiveConfig.of(archiveConfig)
            )
          )
        )
      )
    );
    const evidence = {
      attributes: Object.fromEntries(span.attributes),
      logs,
      rejected,
      status: {
        exit: span.status._tag === "Ended" ? span.status.exit._tag : undefined,
        tag: span.status._tag,
      },
    };
    const serialized = JSON.stringify(evidence, (_key, value) =>
      typeof value === "bigint" ? String(value) : value
    );

    expect(evidence).toMatchObject({
      attributes: { "email.rejection_reason": "archive-unavailable" },
      logs: [],
      rejected: ["Inbound email archive is not available"],
      status: { exit: "Success", tag: "Ended" },
    });
    expect(serialized).not.toContain(privateCause);
    expect(serialized).not.toContain(archiveRecipient);
  });

  it.each([
    {
      expectedReject: "Invalid envelope recipient",
      label: "invalid envelope",
      message: { to: "bad recipient" },
      receiveFailure: undefined,
      resolveFailure: undefined,
    },
    {
      expectedReject: "Message too large",
      label: "invalid size",
      message: { rawSize: MAXIMUM_INBOUND_RAW_BYTES + 1 },
      receiveFailure: undefined,
      resolveFailure: undefined,
    },
    {
      expectedReject: "Mailbox recipient is not configured",
      label: "unknown recipient",
      message: {},
      receiveFailure: undefined,
      resolveFailure: new InboundEmailRejected({
        message: "Mailbox recipient is not configured",
        reason: "unknown-recipient",
      }),
    },
    {
      expectedReject: "Inbound email processing is not available",
      label: "synthetic resolver failure",
      message: {},
      receiveFailure: undefined,
      resolveFailure: new InboundEmailRejected({
        message: "Inbound email processing is not available",
        reason: "processing-unavailable",
      }),
    },
    {
      expectedReject: "Inbound email processing is not available",
      label: "synthetic ingress storage failure",
      message: {},
      receiveFailure: new InboundEmailRejected({
        message: "Inbound email processing is not available",
        reason: "processing-unavailable",
      }),
      resolveFailure: undefined,
    },
    {
      expectedReject: "Inbound email processing is not available",
      label: "synthetic ingress Workflow failure",
      message: {},
      receiveFailure: new InboundEmailRejected({
        message: "Inbound email processing is not available",
        reason: "processing-unavailable",
      }),
      resolveFailure: undefined,
    },
  ])("does not forward after a $label", async (testCase) => {
    let attempts = 0;
    const { message, rejected } = makeMessage({
      ...testCase.message,
      forward: () => {
        attempts += 1;
        return Promise.resolve({ messageId: "must-not-forward" });
      },
    });

    await runWithIngress(
      message,
      () =>
        testCase.receiveFailure === undefined
          ? Effect.void
          : Effect.fail(testCase.receiveFailure),
      () =>
        testCase.resolveFailure === undefined
          ? Effect.succeed(primaryMailboxId)
          : Effect.fail(testCase.resolveFailure)
    );

    expect(attempts).toBe(0);
    expect(rejected).toStrictEqual([testCase.expectedReject]);
  });

  it("accepts the exact raw limit without consuming the stream", async () => {
    let pulls = 0;
    let received = 0;
    let resolved = 0;
    let deliveredRaw: InboundEmailRoutingMessage["raw"] | undefined;
    const raw = lazyRawStream(() => {
      pulls += 1;
    });
    const { message, rejected } = makeMessage({
      raw,
      rawSize: MAXIMUM_INBOUND_RAW_BYTES,
    });

    await runWithIngress(
      message,
      (input) =>
        Effect.sync(() => {
          deliveredRaw = input.raw;
          received += 1;
        }),
      () =>
        Effect.sync(() => {
          resolved += 1;
          return primaryMailboxId;
        })
    );

    expect({
      pulls,
      received,
      rejected,
      resolved,
      sameRaw: deliveredRaw === raw,
    }).toStrictEqual({
      pulls: 0,
      received: 1,
      rejected: [],
      resolved: 1,
      sameRaw: true,
    });
  });

  it("rejects above the raw limit before decoding or consuming anything else", async () => {
    let pulls = 0;
    let received = 0;
    let resolved = 0;
    const { message, rejected } = makeMessage({
      from: "bad sender",
      raw: lazyRawStream(() => {
        pulls += 1;
      }),
      rawSize: MAXIMUM_INBOUND_RAW_BYTES + 1,
      to: "bad recipient",
    });

    await runWithIngress(
      message,
      () =>
        Effect.sync(() => {
          received += 1;
        }),
      () =>
        Effect.sync(() => {
          resolved += 1;
          return primaryMailboxId;
        })
    );

    expect({ pulls, received, rejected, resolved }).toStrictEqual({
      pulls: 0,
      received: 0,
      rejected: ["Message too large"],
      resolved: 0,
    });
  });

  it.each([
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])(
    "keeps invalid raw size %s in the invalid-envelope path",
    async (rawSize) => {
      let received = 0;
      let resolved = 0;
      const { message, rejected } = makeMessage({ rawSize });

      await runWithIngress(
        message,
        () =>
          Effect.sync(() => {
            received += 1;
          }),
        () =>
          Effect.sync(() => {
            resolved += 1;
            return primaryMailboxId;
          })
      );

      expect({ received, rejected, resolved }).toStrictEqual({
        received: 0,
        rejected: ["Invalid raw message size"],
        resolved: 0,
      });
    }
  );

  it("passes the SMTP envelope recipient instead of the To header", async () => {
    const { message, rejected } = makeMessage();
    let delivered: InboundEmailRoutingMessage | undefined;
    let resolvedRecipient: string | undefined;

    await runWithIngress(
      message,
      (input) =>
        Effect.sync(() => {
          delivered = input;
        }),
      (recipient) =>
        Effect.sync(() => {
          resolvedRecipient = recipient;
          return primaryMailboxId;
        })
    );

    expect(rejected).toStrictEqual([]);
    expect(resolvedRecipient).toBe("owner@example.com");
    expect(delivered?.mailboxId).toBe("primary");
    expect(delivered?.envelope).toStrictEqual({
      envelopeFrom: "sender@example.com",
      envelopeTo: "owner@example.com",
      rawSize: 3,
    });
    expect({
      headerRecipient: delivered?.headers.get("to"),
      rawIsPreserved: delivered?.raw === message.raw,
    }).toStrictEqual({
      headerRecipient: "header-recipient@example.com",
      rawIsPreserved: true,
    });
  });

  it("rejects malformed envelope recipients before ingress", async () => {
    const { message, rejected } = makeMessage({ to: "bad recipient" });
    let received = 0;
    let resolved = 0;

    await runWithIngress(
      message,
      () =>
        Effect.sync(() => {
          received += 1;
        }),
      () =>
        Effect.sync(() => {
          resolved += 1;
          return primaryMailboxId;
        })
    );

    expect(received).toBe(0);
    expect(resolved).toBe(0);
    expect(rejected).toStrictEqual(["Invalid envelope recipient"]);
  });

  it("accepts null reverse-path senders", async () => {
    const { message, rejected } = makeMessage({ from: "" });
    let delivered: InboundEmailRoutingMessage | undefined;

    await runWithIngress(message, (input) =>
      Effect.sync(() => {
        delivered = input;
      })
    );

    expect(rejected).toStrictEqual([]);
    expect(delivered?.envelope).toStrictEqual({
      envelopeFrom: undefined,
      envelopeTo: "owner@example.com",
      rawSize: 3,
    });
  });

  it("rejects unknown envelope recipients before ingress", async () => {
    const { message, rejected } = makeMessage();
    let received = 0;

    await runWithIngress(
      message,
      () =>
        Effect.sync(() => {
          received += 1;
        }),
      () =>
        Effect.fail(
          new InboundEmailRejected({
            message: "Mailbox recipient is not configured",
            reason: "unknown-recipient",
          })
        )
    );

    expect(received).toBe(0);
    expect(rejected).toStrictEqual(["Mailbox recipient is not configured"]);
  });

  it("uses a safe unavailable live layer until durable ingress exists", async () => {
    const { message, rejected } = makeMessage();

    await Effect.runPromise(
      handleCloudflareEmailRoutingMessage(message).pipe(
        Effect.provide(
          Layer.mergeAll(
            MailboxInboundEmailIngressUnavailableLayer,
            Layer.succeed(
              InboundMailboxResolver,
              InboundMailboxResolver.of({
                resolve: () => Effect.succeed(primaryMailboxId),
              })
            ),
            Layer.succeed(
              MailboxArchiveConfig,
              MailboxArchiveConfig.of(archiveConfig)
            )
          )
        )
      )
    );

    expect(rejected).toStrictEqual([
      "Inbound email processing is not available",
    ]);
  });
});
