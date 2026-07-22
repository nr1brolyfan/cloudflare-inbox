import { RateLimitDurableObject } from "@effect-auth/core/AlchemyCloudflareRateLimitDurableObject";
import { ALCHEMY_DEV, RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerRespondable from "effect/unstable/http/HttpServerRespondable";

import { AiInferenceUnavailableLive } from "../ai/inference";
import {
  WorkersAiClientLive,
  WorkersAiConfigLive,
  WorkersAiGateway,
  WorkersAiInferenceLive,
} from "../ai/workers-ai-live";
import { AuthRuntimeConfig, AuthRuntimeConfigSchema } from "../auth/live";
import {
  ControlPlaneD1Binding,
  ControlPlaneDatabaseLive,
} from "../control-plane/database";
import { InboundMailboxResolverLive } from "../control-plane/inbound-mailbox-resolver-live";
import { MailboxAdministrationConfig } from "../control-plane/mailbox-administration-live";
import { BackendHttpLive } from "../http/backend";
import { DevEmailConfig } from "../http/dev-emails";
import {
  AuthEmailSender,
  ControlPlaneDatabase as ControlPlaneDatabaseResource,
  InboxAiGateway,
  MailboxEmailSender,
  RawMessagesBucket,
} from "../infra/resources";
import {
  CloudflareOutboundEmailProviderLive,
  MailboxEmailSendBindingClient,
  MailboxEmailSendClientLive,
} from "../mailboxes/cloudflare-email-sending-live";
import { EmailAddress } from "../mailboxes/core";
import { MailboxDoNamespace } from "../mailboxes/do-client";
import type { DraftAttachmentR2Object } from "../mailboxes/draft-attachment-store-r2-live";
import { DraftAttachmentR2Client } from "../mailboxes/draft-attachment-store-r2-live";
import { InboundAttachmentR2ReadClient } from "../mailboxes/inbound-attachment-reader-r2-live";
import {
  InboundEmailIngressLive,
  InboundEmailIngressRuntimeLive,
  RawMessagesR2Client,
} from "../mailboxes/inbound-email-ingress-live";
import { handleCloudflareEmailRoutingMessage } from "../mailboxes/inbound-email-routing";
import {
  InboundWorkflowClient,
  InboundWorkflowStarterLive,
} from "../mailboxes/inbound-workflow-starter-live";
import { MailboxDO } from "../mailboxes/mailbox-do";
import { OutboundDraftAttachmentR2ReadClient } from "../mailboxes/outbound-draft-attachment-reader-r2-live";
import { OutboundEmailProviderUnavailableLive } from "../mailboxes/outbound-email-provider";
import {
  BackendObservabilityConfig,
  BackendObservabilityLive,
} from "../observability/backend";
import { BackendHealthBindings } from "../observability/backend-health-live";
import {
  BackendRequestCompletionLive,
  backendRequestContext,
} from "../observability/backend-request-live";
import {
  BackendRequestCompletion,
  backendRequestMethod,
  backendRequestRoute,
} from "../observability/request-completion";
import {
  CurrentBackendRequestContext,
  backendRequestContextAnnotations,
} from "../observability/request-context";
import InboundWorkflow from "../workflows/inbound-workflow";
import {
  EmailRoutingEventSource,
  EmailRoutingEventSourceLive,
} from "./email-routing-event-source";

const r2AttachmentObject = (object: {
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
      : [...new Uint8Array(object.checksums.sha256)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join(""),
  size: object.size,
});

export default class Backend extends Cloudflare.Worker<Backend>()(
  "Backend",
  {
    main: import.meta.url,
    compatibility: {
      date: "2026-07-11",
      flags: ["nodejs_compat"],
    },
    dev: {
      port: 1338,
      strictPort: true,
    },
    observability: {
      enabled: true,
      logs: {
        enabled: true,
        headSamplingRate: 1,
        invocationLogs: true,
        persist: true,
      },
      traces: {
        enabled: true,
        headSamplingRate: 1,
        persist: true,
      },
    },
    url: false,
    env: {
      MAILBOX_OUTBOUND_PROVIDER_DISABLED: ALCHEMY_DEV,
    },
  },
  Effect.gen(function* () {
    const controlPlane = yield* Cloudflare.D1.QueryDatabase(
      ControlPlaneDatabaseResource
    );
    const rawMessages = yield* Cloudflare.R2.ReadWriteBucket(RawMessagesBucket);
    const authRateLimit = yield* RateLimitDurableObject;
    const mailboxDataPlane = yield* MailboxDO;
    const inboundWorkflow = yield* InboundWorkflow;
    const emailRouting = yield* EmailRoutingEventSource;
    const isDevelopment = yield* ALCHEMY_DEV;
    const aiInferenceLive = isDevelopment
      ? AiInferenceUnavailableLive
      : yield* Effect.gen(function* () {
          const queryGateway =
            yield* Cloudflare.AI.QueryGateway(InboxAiGateway);
          return WorkersAiInferenceLive.pipe(
            Layer.provide(
              WorkersAiClientLive.pipe(
                Layer.provide(WorkersAiConfigLive),
                Layer.provide(
                  Layer.succeed(
                    WorkersAiGateway,
                    WorkersAiGateway.of({
                      run: ({ input, model }) =>
                        Effect.gen(function* () {
                          const [ai, gatewayId] = yield* Effect.all([
                            queryGateway.raw,
                            queryGateway.id,
                          ]).pipe(Effect.provide(RuntimeContext.phantom));

                          return yield* Effect.tryPromise({
                            try: () =>
                              ai.run(model, input, {
                                gateway: { id: gatewayId },
                              }),
                            catch: (cause) => cause,
                          });
                        }),
                    })
                  )
                )
              )
            )
          );
        });
    const mailboxEmailSendBinding = isDevelopment
      ? undefined
      : yield* Cloudflare.Email.Send(MailboxEmailSender);
    const otlpBaseUrl = isDevelopment
      ? Option.getOrUndefined(
          yield* Config.option(Config.string("OTEL_EXPORTER_OTLP_ENDPOINT"))
        )
      : undefined;
    const publicOrigin = yield* Config.string("PUBLIC_ORIGIN");
    const emailFrom = yield* Config.string("AUTH_EMAIL_FROM");
    const mailboxOwnerEmail = yield* Schema.decodeUnknownEffect(EmailAddress)(
      yield* Config.string("MAILBOX_OWNER_EMAIL")
    ).pipe(Effect.orDie);
    const sessionSecret = yield* Config.redacted("AUTH_SESSION_SECRET");
    const challengeSecret = yield* Config.redacted("AUTH_CHALLENGE_SECRET");
    const privacySecret = yield* Config.redacted("AUTH_PRIVACY_SECRET");
    const delivery = isDevelopment
      ? ({ _tag: "development" } as const)
      : ({
          _tag: "production",
          emailSender: yield* Cloudflare.Email.Send(AuthEmailSender),
        } as const);
    const authRuntimeConfig = yield* Schema.decodeUnknownEffect(
      AuthRuntimeConfigSchema
    )({
      delivery,
      emailFrom,
      publicOrigin,
      rateLimitNamespace: authRateLimit,
      secrets: {
        challenge: challengeSecret,
        privacy: privacySecret,
        session: sessionSecret,
      },
    }).pipe(Effect.orDie);
    const authRuntimeConfigLive = Layer.succeed(
      AuthRuntimeConfig,
      AuthRuntimeConfig.of(authRuntimeConfig)
    );
    const workflowClientLive = Layer.succeed(
      InboundWorkflowClient,
      InboundWorkflowClient.of({
        create: (options) => inboundWorkflow.create(options),
        get: (instanceId) => inboundWorkflow.get(instanceId),
      })
    );
    const attachmentReadClientLive = Layer.succeed(
      InboundAttachmentR2ReadClient,
      InboundAttachmentR2ReadClient.of({
        get: (key) =>
          rawMessages.get(key).pipe(
            Effect.provide(RuntimeContext.phantom),
            Effect.map((object) => {
              if (object === null) {
                return null;
              }
              const checksum = object.checksums.sha256;
              return {
                arrayBuffer: object.arrayBuffer,
                contentType: object.httpMetadata?.contentType,
                customMetadata: object.customMetadata ?? {},
                sha256:
                  checksum === undefined
                    ? undefined
                    : [...new Uint8Array(checksum)]
                        .map((byte) => byte.toString(16).padStart(2, "0"))
                        .join(""),
                size: object.size,
              };
            })
          ),
      })
    );
    const draftAttachmentClientLive = Layer.succeed(
      DraftAttachmentR2Client,
      DraftAttachmentR2Client.of({
        head: (key) =>
          rawMessages.head(key).pipe(
            Effect.provide(RuntimeContext.phantom),
            Effect.map((object) =>
              object === null ? null : r2AttachmentObject(object)
            )
          ),
        put: (key, content, options) =>
          rawMessages.put(key, content, options).pipe(
            Effect.provide(RuntimeContext.phantom),
            Effect.map((object) =>
              object === null ? null : r2AttachmentObject(object)
            )
          ),
      })
    );
    const outboundAttachmentReadClientLive = Layer.succeed(
      OutboundDraftAttachmentR2ReadClient,
      OutboundDraftAttachmentR2ReadClient.of({
        get: (key) =>
          rawMessages.get(key).pipe(
            Effect.provide(RuntimeContext.phantom),
            Effect.map((object) => {
              if (object === null) {
                return null;
              }
              const checksum = object.checksums.sha256;
              return {
                arrayBuffer: object.arrayBuffer,
                contentType: object.httpMetadata?.contentType,
                customMetadata: object.customMetadata ?? {},
                sha256:
                  checksum === undefined
                    ? undefined
                    : [...new Uint8Array(checksum)]
                        .map((byte) => byte.toString(16).padStart(2, "0"))
                        .join(""),
                size: object.size,
              };
            })
          ),
      })
    );
    const mailboxOutboundProviderLive =
      mailboxEmailSendBinding === undefined
        ? OutboundEmailProviderUnavailableLive
        : CloudflareOutboundEmailProviderLive.pipe(
            Layer.provide(MailboxEmailSendClientLive),
            Layer.provide(
              Layer.succeed(
                MailboxEmailSendBindingClient,
                mailboxEmailSendBinding
              )
            )
          );
    const workerServicesLive = Layer.mergeAll(
      authRuntimeConfigLive,
      workflowClientLive,
      attachmentReadClientLive,
      draftAttachmentClientLive,
      outboundAttachmentReadClientLive,
      mailboxOutboundProviderLive,
      aiInferenceLive,
      Layer.succeed(
        MailboxAdministrationConfig,
        MailboxAdministrationConfig.of({ ownerEmail: mailboxOwnerEmail })
      ),
      Layer.succeed(
        MailboxDoNamespace,
        MailboxDoNamespace.of(mailboxDataPlane)
      ),
      Layer.succeed(
        BackendHealthBindings,
        BackendHealthBindings.of({
          authRateLimit,
          mailboxDataPlane,
          rawMessages,
        })
      ),
      Layer.succeed(DevEmailConfig, DevEmailConfig.of({ isDevelopment }))
    );
    const completionContext = yield* Layer.build(BackendRequestCompletionLive);
    const observabilityLive = BackendObservabilityLive.pipe(
      Layer.provide(
        Layer.succeed(
          BackendObservabilityConfig,
          BackendObservabilityConfig.of({ isDevelopment, otlpBaseUrl })
        )
      )
    );
    yield* emailRouting.listen((message) =>
      Effect.gen(function* () {
        const controlPlaneDatabase = yield* controlPlane.raw;
        const controlPlaneDatabaseLive = ControlPlaneDatabaseLive.pipe(
          Layer.provide(
            Layer.succeed(
              ControlPlaneD1Binding,
              ControlPlaneD1Binding.of({ database: controlPlaneDatabase })
            )
          )
        );
        const rawMessagesLive = Layer.succeed(
          RawMessagesR2Client,
          RawMessagesR2Client.of({
            put: (key, value, options) =>
              rawMessages
                .put(key, value as unknown as ReadableStream, options)
                .pipe(Effect.provide(RuntimeContext.phantom)),
          })
        );
        const workflowStarterLive = InboundWorkflowStarterLive.pipe(
          Layer.provide(workflowClientLive)
        );
        const inboundEmailIngressLive = InboundEmailIngressLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              rawMessagesLive,
              InboundEmailIngressRuntimeLive,
              workflowStarterLive
            )
          )
        );
        const inboundServicesLive = Layer.merge(
          InboundMailboxResolverLive.pipe(
            Layer.provide(controlPlaneDatabaseLive)
          ),
          inboundEmailIngressLive
        );

        return yield* handleCloudflareEmailRoutingMessage(message).pipe(
          Effect.withSpan("backend.email", {
            attributes: {
              "email.raw_size": message.rawSize,
            },
            kind: "server",
            root: true,
          }),
          Effect.provide(inboundServicesLive)
        );
      })
    );
    return {
      fetch: Effect.gen(function* () {
        const startedAtNanos = yield* Clock.currentTimeNanos;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const requestUrl = new URL(request.url, authRuntimeConfig.publicOrigin);
        const requestContext = backendRequestContext(request.headers["cf-ray"]);
        const completion = yield* BackendRequestCompletion.pipe(
          Effect.provide(completionContext)
        );
        // Building in Alchemy's request scope flushes OTLP finalizers through waitUntil.
        const observabilityExit = yield* Layer.build(observabilityLive).pipe(
          Effect.exit
        );
        if (Exit.isFailure(observabilityExit)) {
          yield* completion
            .emit({
              context: requestContext,
              method: request.method,
              pathname: requestUrl.pathname,
              startedAtNanos,
              statusCode: 500,
            })
            .pipe(Effect.catchCause(() => Effect.void));
          return yield* Effect.failCause(observabilityExit.cause);
        }
        const observabilityContext = observabilityExit.value;

        return yield* Effect.gen(function* () {
          const responseStatus = yield* Ref.make(500);
          const requestEffect = Effect.gen(function* () {
            yield* Effect.annotateCurrentSpan(
              backendRequestContextAnnotations(requestContext)
            );
            const controlPlaneDatabase = yield* controlPlane.raw;
            const routesLive = BackendHttpLive.pipe(
              Layer.provide(
                Layer.succeed(
                  ControlPlaneD1Binding,
                  ControlPlaneD1Binding.of({
                    database: controlPlaneDatabase,
                  })
                )
              ),
              Layer.provide(workerServicesLive),
              Layer.provide(
                Layer.succeed(
                  CurrentBackendRequestContext,
                  CurrentBackendRequestContext.of(requestContext)
                )
              )
            );
            const handler = yield* HttpRouter.toHttpEffect(routesLive);
            const response = yield* handler.pipe(
              Effect.catchTag(
                "HttpServerError",
                HttpServerRespondable.toResponse
              )
            );
            yield* Ref.set(responseStatus, response.status);
            return response;
          });

          return yield* requestEffect.pipe(
            Effect.ensuring(
              Ref.get(responseStatus).pipe(
                Effect.flatMap((statusCode) =>
                  completion.emit({
                    context: requestContext,
                    method: request.method,
                    pathname: requestUrl.pathname,
                    startedAtNanos,
                    statusCode,
                  })
                ),
                Effect.catchCause(() => Effect.void)
              )
            )
          );
        }).pipe(
          Effect.withSpan("backend.request", {
            attributes: {
              "http.request.method": backendRequestMethod(request.method),
              "http.route": backendRequestRoute(requestUrl.pathname),
            },
            kind: "server",
            root: true,
          }),
          Effect.provide(observabilityContext)
        );
      }),
    };
  }).pipe(
    Effect.provide(EmailRoutingEventSourceLive),
    Effect.provide(Cloudflare.AI.QueryGatewayBinding),
    Effect.provide(Cloudflare.D1.QueryDatabaseBinding),
    Effect.provide(Cloudflare.Email.SendBinding),
    Effect.provide(Cloudflare.R2.ReadWriteBucketBinding)
  )
) {}
