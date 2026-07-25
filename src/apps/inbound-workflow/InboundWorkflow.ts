import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import AsyncRuleWorkflow from "#/apps/async-rule-workflow/AsyncRuleWorkflow";
import { MailboxDO } from "#/apps/mailbox-do/MailboxDO";
import {
  AsyncRuleWorkflowClient,
  AsyncRuleWorkflowStarterCloudflareLayer,
} from "#/modules/automation/adapters/workflow/AsyncRuleWorkflowStarterCloudflare";
import { AsyncRuleWorkflowStarter } from "#/modules/automation/ports/AsyncRuleWorkflowStarter";
import { MailboxDoNamespace } from "#/modules/mailbox/adapters/durable-object/MailboxDoClient";
import { InboundAttachmentR2Client } from "#/modules/mailbox/adapters/r2/InboundAttachmentStoreR2";
import { InboundRawMessageR2Client } from "#/modules/mailbox/adapters/r2/InboundRawMessageReaderR2";
import type { AsyncRuleJobId } from "#/modules/mailbox/domain/Mailbox";
import type { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import type { ParsedInboundMessageV1 as ParsedInboundMessageV1Type } from "#/modules/mailbox/domain/MailboxInbound";
import {
  InboundWorkflowParams,
  InboundWorkflowResultV1,
  ParsedInboundMessageV1,
} from "#/modules/mailbox/domain/MailboxInbound";
import { MailboxInboundLayer } from "#/modules/mailbox/layers/MailboxInboundLayer";
import { InboundAttachmentStore } from "#/modules/mailbox/ports/InboundAttachmentStore";
import {
  InboundManifestMismatchError,
  InboundMimeAttachmentExtractor,
  InboundMimeParser,
  InboundRetryableStepError,
} from "#/modules/mailbox/ports/InboundMimeParser";
import type { MimeParseError } from "#/modules/mailbox/ports/InboundMimeParser";
import { InboundRawMessageReader } from "#/modules/mailbox/ports/InboundRawMessageReader";
import type { BlobStoreError } from "#/modules/mailbox/ports/MailboxBlobStore";
import {
  InboundMessageCommitter,
  InboundProcessingRecorder,
} from "#/modules/mailbox/ports/MailboxInboundRepository";
import { MailboxOperationalStatus } from "#/modules/mailbox/ports/MailboxOperationalStatus";
import type { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";
import { mailboxOperationalStatusD1Layer } from "#/modules/organization/adapters/d1/MailboxOperationalStatusD1";
import {
  ControlPlaneDatabase as ControlPlaneDatabaseResource,
  RawMessagesBucket,
} from "#/platform/cloudflare/Resources";

const encodedManifest = (manifest: ParsedInboundMessageV1Type) =>
  JSON.stringify(Schema.encodeSync(ParsedInboundMessageV1)(manifest));

const checksumHex = (value: ArrayBuffer) =>
  [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const attachmentObject = (object: {
  readonly checksums: { readonly sha256?: ArrayBuffer };
  readonly customMetadata?: Record<string, string>;
  readonly httpMetadata?: { readonly contentType?: string };
  readonly size: number;
}) => ({
  contentType: object.httpMetadata?.contentType,
  customMetadata: object.customMetadata ?? {},
  sha256:
    object.checksums.sha256 === undefined
      ? undefined
      : checksumHex(object.checksums.sha256),
  size: object.size,
});

interface ProcessingFailure {
  readonly code:
    | "malformed_message"
    | "message_too_large"
    | "unsupported_message"
    | "processing_failed";
  readonly replayable: boolean;
}

type StepOutcome<A> =
  | { readonly _tag: "Success"; readonly value: A }
  | { readonly _tag: "Failure"; readonly failure: ProcessingFailure }
  | { readonly _tag: "Rejected" };

const isRetryableStepError = (value: unknown): boolean => {
  const visited = new Set<unknown>();
  let current = value;
  while (typeof current === "object" && current !== null) {
    if (current instanceof InboundRetryableStepError) {
      return true;
    }
    if (visited.has(current) || !("cause" in current)) {
      return false;
    }
    visited.add(current);
    current = current.cause;
  }
  return false;
};

const processingTaskConfig = {
  retries: { limit: 5, delay: "5 seconds", backoff: "exponential" },
  timeout: "5 minutes",
} as const;

const mailboxStateTaskConfig = {
  retries: { limit: 5, delay: "2 seconds", backoff: "exponential" },
  timeout: "1 minute",
} as const;

/** Application graph whose binding clients are supplied per Workflow instance. */
export const InboundWorkflowApplicationLayer = Layer.merge(
  MailboxInboundLayer,
  AsyncRuleWorkflowStarterCloudflareLayer
);

const mimeFailure = (error: MimeParseError): ProcessingFailure => ({
  code:
    error.reason === "malformed-message"
      ? "malformed_message"
      : error.reason === "message-too-large"
        ? "message_too_large"
        : "unsupported_message",
  replayable: false,
});

const blobFailure = <A>(
  error: BlobStoreError
): Effect.Effect<StepOutcome<A>> =>
  error.retryable
    ? Effect.die(new InboundRetryableStepError(error))
    : Effect.succeed({
        _tag: "Failure",
        failure: { code: "processing_failed", replayable: false },
      });

const repositoryFailure = <A>(
  error: MailboxRepositoryError
): Effect.Effect<StepOutcome<A>> =>
  error.retryable
    ? Effect.die(new InboundRetryableStepError(error))
    : Effect.succeed({
        _tag: "Failure",
        failure: { code: "processing_failed", replayable: false },
      });

export const inboundWorkflowProgram = Effect.succeed((input: unknown) =>
  Effect.gen(function* () {
    const params = yield* Schema.decodeUnknownEffect(InboundWorkflowParams)(
      input
    ).pipe(Effect.orDie);
    const event = yield* Cloudflare.Workflows.WorkflowEvent;

    const expectedInstanceId =
      params.formatVersion === 1
        ? params.inboundIngestId
        : params.workflowInstanceId;
    if (event.instanceId !== expectedInstanceId) {
      return yield* Effect.die(
        new Error("Inbound Workflow instance ID does not match its ingest ID")
      );
    }

    const recordCheckpoint = (
      name: string,
      status: "raw_stored" | "parsing" | "attachments_stored"
    ) =>
      Cloudflare.Workflows.task(
        name,
        InboundProcessingRecorder.pipe(
          Effect.flatMap((recorder) =>
            recorder.record({
              _tag: "Checkpoint",
              envelope: params.envelope,
              ...(params.formatVersion === 1
                ? { formatVersion: 1 as const }
                : {
                    executionAttempt: params.executionAttempt,
                    formatVersion: 2 as const,
                  }),
              inboundIngestId: params.inboundIngestId,
              mailboxId: params.mailboxId,
              receivedAt: params.receivedAt,
              status,
            })
          ),
          Effect.matchEffect({
            onFailure: (error) =>
              error._tag === "MailboxRepositoryError" && error.retryable
                ? Effect.die(new InboundRetryableStepError(error))
                : Effect.succeed({ _tag: "Rejected" as const }),
            onSuccess: (value) =>
              Effect.succeed({ _tag: "Recorded" as const, value }),
          })
        ),
        mailboxStateTaskConfig
      );
    let parsedForFailure: ParsedInboundMessageV1Type | undefined;
    const taskSuffix = params.formatVersion === 1 ? "v2" : "v3";
    const recordFailure = (failure: ProcessingFailure) =>
      Cloudflare.Workflows.task(
        `record-inbound-failure-${taskSuffix}`,
        InboundProcessingRecorder.pipe(
          Effect.flatMap((recorder) =>
            recorder.record({
              _tag: "Failure",
              envelope: params.envelope,
              failure,
              ...(params.formatVersion === 1
                ? { formatVersion: 1 as const }
                : {
                    executionAttempt: params.executionAttempt,
                    formatVersion: 2 as const,
                  }),
              inboundIngestId: params.inboundIngestId,
              mailboxId: params.mailboxId,
              message: parsedForFailure,
              receivedAt: params.receivedAt,
            })
          ),
          Effect.matchEffect({
            onFailure: (error) =>
              error._tag === "MailboxRepositoryError" && error.retryable
                ? Effect.die(new InboundRetryableStepError(error))
                : Effect.succeed({ _tag: "Rejected" as const }),
            onSuccess: (value) =>
              Effect.succeed({ _tag: "Recorded" as const, value }),
          })
        ),
        mailboxStateTaskConfig
      );

    const processing = yield* Effect.exit(
      Effect.gen(function* () {
        for (const [name, status] of [
          [`record-raw-stored-${taskSuffix}`, "raw_stored"],
          [`record-parsing-${taskSuffix}`, "parsing"],
        ] as const) {
          const recorded = yield* recordCheckpoint(name, status);
          if (recorded._tag === "Rejected") {
            return yield* Effect.die(
              new Error("MailboxDO rejected an inbound checkpoint")
            );
          }
          if (recorded.value.status === "ready") {
            return { _tag: "Completed" as const, value: recorded.value };
          }
          if (recorded.value.status === "failed") {
            return { _tag: "Stopped" as const };
          }
        }

        const parsed = yield* Cloudflare.Workflows.task(
          `parse-raw-mime-${taskSuffix}`,
          Effect.gen(function* () {
            const reader = yield* InboundRawMessageReader;
            const parser = yield* InboundMimeParser;
            const raw = yield* reader.read({
              inboundIngestId: params.inboundIngestId,
              mailboxId: params.mailboxId,
              rawSize: params.envelope.rawSize,
              receivedAt: params.receivedAt,
            });
            return yield* parser.parse(raw);
          }).pipe(
            Effect.matchEffect({
              onFailure: (
                error
              ): Effect.Effect<StepOutcome<ParsedInboundMessageV1Type>> =>
                error._tag === "MimeParseError"
                  ? Effect.succeed({
                      _tag: "Failure",
                      failure: mimeFailure(error),
                    })
                  : blobFailure(error),
              onSuccess: (value) =>
                Effect.succeed({ _tag: "Success" as const, value }),
            })
          ),
          processingTaskConfig
        );
        if (parsed._tag === "Failure") {
          return { _tag: "Failed" as const, failure: parsed.failure };
        }
        if (parsed._tag === "Rejected") {
          return { _tag: "Rejected" as const };
        }
        parsedForFailure = parsed.value;

        const attachments = yield* Cloudflare.Workflows.task(
          `store-inbound-attachments-${taskSuffix}`,
          Effect.gen(function* () {
            const reader = yield* InboundRawMessageReader;
            const extractor = yield* InboundMimeAttachmentExtractor;
            const store = yield* InboundAttachmentStore;
            const raw = yield* reader.read({
              inboundIngestId: params.inboundIngestId,
              mailboxId: params.mailboxId,
              rawSize: params.envelope.rawSize,
              receivedAt: params.receivedAt,
            });
            const extracted = yield* extractor.extract(raw);
            if (
              encodedManifest(parsed.value) !==
              encodedManifest(extracted.manifest)
            ) {
              return yield* Effect.fail(
                new InboundManifestMismatchError({
                  message: "Reparsed inbound MIME manifest does not match",
                })
              );
            }
            yield* store.store({
              attachments: extracted.attachments,
              inboundIngestId: params.inboundIngestId,
              mailboxId: params.mailboxId,
              receivedAt: params.receivedAt,
            });
          }).pipe(
            Effect.matchEffect({
              onFailure: (error): Effect.Effect<StepOutcome<void>> => {
                switch (error._tag) {
                  case "BlobStoreError": {
                    return blobFailure(error);
                  }
                  case "MimeParseError": {
                    return Effect.succeed({
                      _tag: "Failure",
                      failure: mimeFailure(error),
                    });
                  }
                  case "InboundManifestMismatchError": {
                    return Effect.succeed({
                      _tag: "Failure",
                      failure: {
                        code: "processing_failed",
                        replayable: false,
                      },
                    });
                  }
                  default: {
                    const exhaustive: never = error;
                    return exhaustive;
                  }
                }
              },
              onSuccess: () =>
                Effect.succeed({ _tag: "Success" as const, value: undefined }),
            })
          ),
          processingTaskConfig
        );
        if (attachments._tag === "Failure") {
          return { _tag: "Failed" as const, failure: attachments.failure };
        }
        if (attachments._tag === "Rejected") {
          return { _tag: "Rejected" as const };
        }

        const stored = yield* recordCheckpoint(
          `record-attachments-stored-${taskSuffix}`,
          "attachments_stored"
        );
        if (stored._tag === "Rejected") {
          return yield* Effect.die(
            new Error("MailboxDO rejected an inbound checkpoint")
          );
        }
        if (stored.value.status === "ready") {
          return { _tag: "Completed" as const, value: stored.value };
        }
        if (stored.value.status === "failed") {
          return { _tag: "Stopped" as const };
        }

        const committed = yield* Cloudflare.Workflows.task(
          `commit-inbound-message-${taskSuffix}`,
          Effect.gen(function* () {
            const operationalStatus = yield* MailboxOperationalStatus;
            const fence = {
              mailboxId: params.mailboxId,
              operationId: params.inboundIngestId,
              operationKind: "inbound-commit" as const,
            };
            const acquired = yield* operationalStatus
              .acquire(fence)
              .pipe(
                Effect.catchTag("MailboxOperationalStatusError", (error) =>
                  Effect.die(new InboundRetryableStepError(error))
                )
              );
            if (!acquired) {
              return null;
            }
            const committer = yield* InboundMessageCommitter;
            return yield* committer
              .commit({
                envelope: params.envelope,
                ...(params.formatVersion === 1
                  ? { formatVersion: 1 as const }
                  : {
                      executionAttempt: params.executionAttempt,
                      formatVersion: 2 as const,
                    }),
                inboundIngestId: params.inboundIngestId,
                mailboxId: params.mailboxId,
                message: parsed.value,
                receivedAt: params.receivedAt,
              })
              .pipe(
                Effect.ensuring(
                  operationalStatus
                    .release({ ...fence, holderId: acquired })
                    .pipe(Effect.orDie)
                )
              );
          }).pipe(
            Effect.matchEffect({
              onFailure: (
                error: MailboxDomainError | MailboxRepositoryError
              ):
                | Effect.Effect<StepOutcome<never>>
                | Effect.Effect<StepOutcome<never>, never> =>
                error._tag === "MailboxRepositoryError"
                  ? repositoryFailure(error)
                  : Effect.succeed({
                      _tag: "Rejected",
                    }),
              onSuccess: (value) =>
                Effect.succeed(
                  value === null
                    ? ({ _tag: "Rejected" } as const)
                    : ({ _tag: "Success", value } as const)
                ),
            })
          ),
          processingTaskConfig
        );
        if (committed._tag === "Failure") {
          return { _tag: "Failed" as const, failure: committed.failure };
        }
        return committed._tag === "Rejected"
          ? { _tag: "Rejected" as const }
          : { _tag: "Completed" as const, value: committed.value };
      })
    );

    const dispatchAsyncRules = (jobId: AsyncRuleJobId | undefined) =>
      jobId === undefined
        ? Effect.void
        : Cloudflare.Workflows.task(
            "start-async-rule-workflow-v1",
            AsyncRuleWorkflowStarter.pipe(
              Effect.flatMap((starter) =>
                starter.start({
                  formatVersion: 1,
                  jobId,
                  mailboxId: params.mailboxId,
                })
              ),
              // The durable pending job remains available for reconciliation.
              Effect.result,
              Effect.asVoid
            ),
            mailboxStateTaskConfig
          );

    if (Exit.isSuccess(processing) && processing.value._tag === "Completed") {
      yield* dispatchAsyncRules(processing.value.value.asyncRuleJobId);
      return yield* Schema.decodeUnknownEffect(InboundWorkflowResultV1)({
        formatVersion: 1,
        inboundIngestId: params.inboundIngestId,
        mailboxId: params.mailboxId,
        messageId: processing.value.value.messageId,
        status: "ready",
      }).pipe(Effect.orDie);
    }
    if (Exit.isSuccess(processing) && processing.value._tag === "Stopped") {
      return yield* Effect.die(
        new Error("Inbound processing is already terminally failed")
      );
    }
    if (Exit.isSuccess(processing) && processing.value._tag === "Rejected") {
      return yield* Effect.die(
        new Error("MailboxDO rejected inbound processing")
      );
    }

    const retryableStepExhausted =
      Exit.isFailure(processing) &&
      isRetryableStepError(Cause.squash(processing.cause));
    if (Exit.isFailure(processing) && !retryableStepExhausted) {
      return yield* Effect.die(Cause.squash(processing.cause));
    }

    const failure =
      Exit.isSuccess(processing) && processing.value._tag === "Failed"
        ? processing.value.failure
        : ({ code: "processing_failed", replayable: true } as const);
    const failed = yield* recordFailure(failure);
    if (
      failed._tag === "Recorded" &&
      failed.value.status === "ready" &&
      failed.value.messageId !== undefined
    ) {
      yield* dispatchAsyncRules(failed.value.asyncRuleJobId);
      return yield* Schema.decodeUnknownEffect(InboundWorkflowResultV1)({
        formatVersion: 1,
        inboundIngestId: params.inboundIngestId,
        mailboxId: params.mailboxId,
        messageId: failed.value.messageId,
        status: "ready",
      }).pipe(Effect.orDie);
    }
    return yield* Effect.die(
      new Error("Inbound processing failed after durable failure recording")
    );
  })
);

export const inboundWorkflowImplementation = Effect.gen(function* () {
  const rawMessages = yield* Cloudflare.R2.ReadWriteBucket(RawMessagesBucket);
  const controlPlane = yield* Cloudflare.D1.QueryDatabase(
    ControlPlaneDatabaseResource
  );
  const mailboxDataPlane = yield* MailboxDO;
  const asyncRuleWorkflow = yield* AsyncRuleWorkflow;
  const rawMessageClientLayer = Layer.succeed(
    InboundRawMessageR2Client,
    InboundRawMessageR2Client.of({
      get: (key) =>
        rawMessages.get(key).pipe(
          Effect.provide(RuntimeContext.phantom),
          Effect.map((object) =>
            object === null
              ? null
              : {
                  arrayBuffer: object.arrayBuffer,
                  customMetadata: object.customMetadata ?? {},
                  size: object.size,
                }
          )
        ),
    })
  );
  const attachmentClientLayer = Layer.succeed(
    InboundAttachmentR2Client,
    InboundAttachmentR2Client.of({
      put: (key, content, options) =>
        rawMessages.put(key, content, options).pipe(
          Effect.provide(RuntimeContext.phantom),
          Effect.map((object) =>
            object === null ? null : attachmentObject(object)
          )
        ),
      head: (key) =>
        rawMessages.head(key).pipe(
          Effect.provide(RuntimeContext.phantom),
          Effect.map((object) =>
            object === null ? null : attachmentObject(object)
          )
        ),
    })
  );
  const mailboxDoNamespaceLayer = Layer.succeed(
    MailboxDoNamespace,
    MailboxDoNamespace.of(mailboxDataPlane)
  );
  const asyncRuleWorkflowClientLayer = Layer.succeed(
    AsyncRuleWorkflowClient,
    AsyncRuleWorkflowClient.of({
      create: (options) =>
        asyncRuleWorkflow
          .create(options)
          .pipe(Effect.provide(RuntimeContext.phantom)),
      get: (instanceId) =>
        asyncRuleWorkflow
          .get(instanceId)
          .pipe(Effect.provide(RuntimeContext.phantom)),
    })
  );
  const controlPlaneDatabase = yield* controlPlane.raw.pipe(
    Effect.provide(RuntimeContext.phantom)
  );
  const instanceApplicationLayer = Layer.merge(
    InboundWorkflowApplicationLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          rawMessageClientLayer,
          attachmentClientLayer,
          mailboxDoNamespaceLayer,
          asyncRuleWorkflowClientLayer
        )
      )
    ),
    mailboxOperationalStatusD1Layer(controlPlaneDatabase)
  );
  const program = yield* inboundWorkflowProgram;

  return (input: unknown) =>
    program(input).pipe(Effect.provide(instanceApplicationLayer));
});

export default class InboundWorkflow extends Cloudflare.Workflow<InboundWorkflow>()(
  "InboundWorkflow",
  inboundWorkflowImplementation
) {}
