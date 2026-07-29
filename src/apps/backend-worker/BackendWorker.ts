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

import InboundWorkflow from "#/apps/inbound-workflow/InboundWorkflow";
import { MailboxDO } from "#/apps/mailbox-do/MailboxDO";
import {
  AuthRuntimeConfig,
  AuthRuntimeConfigSchema,
} from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";
import { DevEmailConfig } from "#/modules/account-security/adapters/http/DevEmailHttpHandlers";
import { AddressRoutingLayer } from "#/modules/address-routing/layers/AddressRoutingLayer";
import {
  WorkersAiClientLayer,
  WorkersAiConfigLayer,
  WorkersAiGateway,
  WorkersAiInferenceLayer,
} from "#/modules/ai/adapters/cloudflare/AiInferenceCloudflare";
import { AiInferenceUnavailableLayer } from "#/modules/ai/layers/AiInferenceLayer";
import { MailboxDoNamespace } from "#/modules/mailbox/adapters/durable-object/MailboxDoClient";
import {
  MailboxEmailSendBindingClient,
  MailboxEmailSendClientCloudflareLayer,
  OutboundEmailProviderCloudflareLayer,
} from "#/modules/mailbox/adapters/email/OutboundEmailProviderCloudflare";
import { OutboundEmailProviderUnavailableLayer } from "#/modules/mailbox/adapters/email/OutboundEmailProviderUnavailable";
import type { DraftAttachmentR2Object } from "#/modules/mailbox/adapters/r2/DraftAttachmentBlobStoreR2";
import { DraftAttachmentR2Client } from "#/modules/mailbox/adapters/r2/DraftAttachmentBlobStoreR2";
import { InboundAttachmentR2ReadClient } from "#/modules/mailbox/adapters/r2/InboundAttachmentBlobReaderR2";
import {
  InboundRawMessageR2WriteClient,
  InboundRawMessageStoreR2Layer,
  InboundRawMessageStoreRuntimeCloudflareLayer,
} from "#/modules/mailbox/adapters/r2/InboundRawMessageStoreR2";
import { OutboundDraftAttachmentR2ReadClient } from "#/modules/mailbox/adapters/r2/OutboundDraftAttachmentBlobReaderR2";
import { MailboxInboundEmailIngressRuntimeSystemLayer } from "#/modules/mailbox/adapters/system/MailboxInboundEmailIngressRuntimeSystem";
import {
  InboundWorkflowClient,
  InboundWorkflowStarterCloudflareLayer,
} from "#/modules/mailbox/adapters/workflow/InboundWorkflowStarterCloudflare";
import { MailboxInboundEmailIngress } from "#/modules/mailbox/application/MailboxInboundEmailIngress";
import {
  MailboxArchiveConfig,
  mailboxArchiveConfig,
} from "#/modules/mailbox/contracts/MailboxArchiveConfig";
import { LegacyMailDomainClaimReconciler } from "#/modules/organization/application/LegacyMailDomainClaimReconciliation";
import {
  MailboxBootstrapConfig,
  mailboxBootstrapConfig,
} from "#/modules/organization/contracts/MailboxBootstrapConfig";
import {
  EmailRoutingEventSource,
  EmailRoutingEventSourceCloudflareLayer,
} from "#/platform/cloudflare/EmailRoutingEventSource";
import {
  AuthEmailSender,
  ControlPlaneDatabase as ControlPlaneDatabaseResource,
  InboxAiGateway,
  MailboxEmailSender,
  RawMessagesBucket,
} from "#/platform/cloudflare/Resources";
import { ControlPlaneD1Layer } from "#/platform/control-plane-d1/ControlPlaneBatch";
import {
  ControlPlaneD1Binding,
  ControlPlaneDatabaseLayer,
} from "#/platform/control-plane-d1/ControlPlaneDatabase";
import {
  BackendObservabilityConfig,
  BackendObservabilityLayer,
} from "#/platform/observability/BackendObservability";
import {
  BackendRequestCompletionLayer,
  BackendRequestCompletion,
  backendRequestMethod,
  backendRequestRoute,
} from "#/platform/observability/BackendRequestCompletion";
import {
  backendRequestContext,
  backendRequestContextAnnotations,
  CurrentBackendRequestContext,
} from "#/platform/observability/BackendRequestContext";

import { BackendApplicationLayer } from "./BackendApplicationLayer";
import { BackendHealthBindings } from "./BackendHealthLayer";
import { handleCloudflareEmailRoutingMessage } from "./CloudflareEmailRoutingIntegration";
import { LegacyMailDomainClaimStoreD1Layer } from "./LegacyMailDomainClaimD1Integration";
import { cacheSuccessfulInitialization } from "./SuccessfulInitialization";

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
    const AiInferenceApplicationLayer = isDevelopment
      ? AiInferenceUnavailableLayer
      : yield* Effect.gen(function* () {
          const queryGateway =
            yield* Cloudflare.AI.QueryGateway(InboxAiGateway);
          return WorkersAiInferenceLayer.pipe(
            Layer.provide(
              WorkersAiClientLayer.pipe(
                Layer.provide(WorkersAiConfigLayer),
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
    const bootstrapConfig = yield* mailboxBootstrapConfig.pipe(Effect.orDie);
    const archiveConfig = yield* mailboxArchiveConfig(
      bootstrapConfig.initialDomain
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
    const AuthRuntimeConfigLayer = Layer.succeed(
      AuthRuntimeConfig,
      AuthRuntimeConfig.of(authRuntimeConfig)
    );
    const InboundWorkflowClientLayer = Layer.succeed(
      InboundWorkflowClient,
      InboundWorkflowClient.of({
        create: (options) => inboundWorkflow.create(options),
        get: (instanceId) => inboundWorkflow.get(instanceId),
      })
    );
    const InboundAttachmentReadClientLayer = Layer.succeed(
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
    const DraftAttachmentClientLayer = Layer.succeed(
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
    const OutboundAttachmentReadClientLayer = Layer.succeed(
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
    const MailboxOutboundProviderLayer =
      mailboxEmailSendBinding === undefined
        ? OutboundEmailProviderUnavailableLayer
        : OutboundEmailProviderCloudflareLayer.pipe(
            Layer.provide(MailboxEmailSendClientCloudflareLayer),
            Layer.provide(
              Layer.succeed(
                MailboxEmailSendBindingClient,
                mailboxEmailSendBinding
              )
            )
          );
    const MailboxBootstrapConfigLayer = Layer.succeed(
      MailboxBootstrapConfig,
      MailboxBootstrapConfig.of(bootstrapConfig)
    );
    const BackendHealthBindingsLayer = Layer.succeed(
      BackendHealthBindings,
      BackendHealthBindings.of({
        authRateLimit,
        mailboxDataPlane,
        rawMessages,
      })
    );
    const BackendBindingsLayer = Layer.mergeAll(
      AuthRuntimeConfigLayer,
      InboundWorkflowClientLayer,
      InboundAttachmentReadClientLayer,
      DraftAttachmentClientLayer,
      OutboundAttachmentReadClientLayer,
      MailboxOutboundProviderLayer,
      AiInferenceApplicationLayer,
      Layer.succeed(
        MailboxArchiveConfig,
        MailboxArchiveConfig.of(archiveConfig)
      ),
      MailboxBootstrapConfigLayer,
      Layer.succeed(
        MailboxDoNamespace,
        MailboxDoNamespace.of(mailboxDataPlane)
      ),
      BackendHealthBindingsLayer,
      Layer.succeed(DevEmailConfig, DevEmailConfig.of({ isDevelopment }))
    );
    const initializeLegacyMailDomainClaim =
      yield* cacheSuccessfulInitialization(
        Effect.gen(function* () {
          const controlPlaneDatabase = yield* controlPlane.raw.pipe(
            Effect.provide(RuntimeContext.phantom)
          );
          const databaseBinding = Layer.succeed(
            ControlPlaneD1Binding,
            ControlPlaneD1Binding.of({ database: controlPlaneDatabase })
          );
          const reconciliationLayer =
            LegacyMailDomainClaimReconciler.layerNoDeps.pipe(
              Layer.provide(LegacyMailDomainClaimStoreD1Layer),
              Layer.provide(ControlPlaneD1Layer),
              Layer.provide(databaseBinding),
              Layer.provide(MailboxBootstrapConfigLayer)
            );
          const reconciler = yield* LegacyMailDomainClaimReconciler.pipe(
            Effect.provide(reconciliationLayer)
          );
          yield* reconciler.initialize.pipe(Effect.orDie);
        })
      );
    const BackendRequestCompletionContext = yield* Layer.build(
      BackendRequestCompletionLayer
    );
    const BackendRequestObservabilityLayer = BackendObservabilityLayer.pipe(
      Layer.provide(
        Layer.succeed(
          BackendObservabilityConfig,
          BackendObservabilityConfig.of({ isDevelopment, otlpBaseUrl })
        )
      )
    );
    yield* emailRouting.listen((message) =>
      Effect.gen(function* () {
        yield* initializeLegacyMailDomainClaim;
        const controlPlaneDatabase = yield* controlPlane.raw;
        const EmailControlPlaneDatabaseLayer = ControlPlaneDatabaseLayer.pipe(
          Layer.provide(
            Layer.succeed(
              ControlPlaneD1Binding,
              ControlPlaneD1Binding.of({ database: controlPlaneDatabase })
            )
          )
        );
        const InboundRawMessagesLayer = Layer.succeed(
          InboundRawMessageR2WriteClient,
          InboundRawMessageR2WriteClient.of({
            put: (key, value, options) =>
              rawMessages
                .put(key, value as unknown as ReadableStream, options)
                .pipe(Effect.provide(RuntimeContext.phantom)),
          })
        );
        const InboundWorkflowStarterLayer =
          InboundWorkflowStarterCloudflareLayer.pipe(
            Layer.provide(InboundWorkflowClientLayer)
          );
        const InboundRawMessageStoreLayer = InboundRawMessageStoreR2Layer.pipe(
          Layer.provide(
            Layer.merge(
              InboundRawMessagesLayer,
              InboundRawMessageStoreRuntimeCloudflareLayer
            )
          )
        );
        const InboundEmailIngressLayer =
          MailboxInboundEmailIngress.layerNoDeps.pipe(
            Layer.provide(
              Layer.mergeAll(
                InboundRawMessageStoreLayer,
                MailboxInboundEmailIngressRuntimeSystemLayer,
                InboundWorkflowStarterLayer
              )
            )
          );
        const InboundEmailApplicationLayer = Layer.mergeAll(
          AddressRoutingLayer.pipe(
            Layer.provide(EmailControlPlaneDatabaseLayer)
          ),
          InboundEmailIngressLayer,
          Layer.succeed(
            MailboxArchiveConfig,
            MailboxArchiveConfig.of(archiveConfig)
          )
        );

        return yield* handleCloudflareEmailRoutingMessage(message).pipe(
          Effect.withSpan("backend.email", {
            attributes: {
              "email.raw_size": message.rawSize,
            },
            kind: "server",
            root: true,
          }),
          Effect.provide(InboundEmailApplicationLayer)
        );
      })
    );
    return {
      fetch: Effect.gen(function* () {
        yield* initializeLegacyMailDomainClaim;
        const startedAtNanos = yield* Clock.currentTimeNanos;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const requestUrl = new URL(request.url, authRuntimeConfig.publicOrigin);
        const requestContext = backendRequestContext(request.headers["cf-ray"]);
        const completion = yield* BackendRequestCompletion.pipe(
          Effect.provide(BackendRequestCompletionContext)
        );
        // Building in Alchemy's request scope flushes OTLP finalizers through waitUntil.
        const observabilityExit = yield* Layer.build(
          BackendRequestObservabilityLayer
        ).pipe(Effect.exit);
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
            const databaseBinding = Layer.succeed(
              ControlPlaneD1Binding,
              ControlPlaneD1Binding.of({ database: controlPlaneDatabase })
            );
            const BackendRequestApplicationLayer = BackendApplicationLayer.pipe(
              Layer.provide(databaseBinding),
              Layer.provide(BackendBindingsLayer),
              Layer.provide(
                Layer.succeed(
                  CurrentBackendRequestContext,
                  CurrentBackendRequestContext.of(requestContext)
                )
              )
            );
            const handler = yield* HttpRouter.toHttpEffect(
              BackendRequestApplicationLayer.pipe(Layer.orDie)
            );
            const response = yield* handler.pipe(
              Effect.provideService(
                CurrentBackendRequestContext,
                requestContext
              ),
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
    Effect.provide(EmailRoutingEventSourceCloudflareLayer),
    Effect.provide(Cloudflare.AI.QueryGatewayBinding),
    Effect.provide(Cloudflare.D1.QueryDatabaseBinding),
    Effect.provide(Cloudflare.Email.SendBinding),
    Effect.provide(Cloudflare.R2.ReadWriteBucketBinding)
  )
) {}
