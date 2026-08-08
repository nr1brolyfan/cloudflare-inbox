import { RateLimitDurableObject } from "@effect-auth/core/AlchemyCloudflareRateLimitDurableObject";
import { ALCHEMY_DEV, RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerRespondable from "effect/unstable/http/HttpServerRespondable";

import InboundWorkflow from "#/apps/inbound-workflow/InboundWorkflow";
import { MailboxDO } from "#/apps/mailbox-do/MailboxDO";
import type { AuthRuntimeConfigShape } from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";
import { DevEmailConfig } from "#/modules/account-security/adapters/http/DevEmailHttpHandlers";
import { AddressRoutingLayer } from "#/modules/address-routing/layers/AddressRoutingLayer";
import {
  InboundRawMessageStoreR2Layer,
  InboundRawMessageStoreRuntimeCloudflareLayer,
} from "#/modules/mailbox/adapters/r2/InboundRawMessageStoreR2";
import { MailboxInboundEmailIngressRuntimeSystemLayer } from "#/modules/mailbox/adapters/system/MailboxInboundEmailIngressRuntimeSystem";
import { InboundWorkflowStarterCloudflareLayer } from "#/modules/mailbox/adapters/workflow/InboundWorkflowStarterCloudflare";
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
  MailboxEmailSender,
  RawMessagesBucket,
} from "#/platform/cloudflare/Resources";
import { ControlPlaneD1Layer } from "#/platform/control-plane-d1/ControlPlaneBatch";
import {
  ControlPlaneD1Binding,
  ControlPlaneDatabaseLayer,
} from "#/platform/control-plane-d1/ControlPlaneDatabase";
import { backendObservabilityLayer } from "#/platform/observability/BackendObservability";
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

import { backendAiInferenceLayer } from "./AiInferenceLayer";
import {
  authRuntimeConfigLayer,
  authRuntimeEnvironmentConfig,
  makeAuthRuntimeConfig,
} from "./AuthRuntimeConfig";
import { BackendApplicationLayer } from "./BackendApplicationLayer";
import { BackendAuthSessionApplicationLayer } from "./BackendAuthSessionApplicationLayer";
import { BackendHealthApplicationLayer } from "./BackendHealthApplicationLayer";
import { backendHttpApplicationKind } from "./BackendHttpApplicationSelection";
import { BackendMagicLinkStartApplicationLayer } from "./BackendMagicLinkStartApplicationLayer";
import {
  backendHealthBindingsLayer,
  draftAttachmentR2ClientLayer,
  inboundAttachmentR2ReadClientLayer,
  inboundRawMessageR2WriteClientLayer,
  inboundWorkflowClientLayer,
  mailboxDoNamespaceLayer,
  mailboxOutboundProviderLayer,
  outboundDraftAttachmentR2ReadClientLayer,
} from "./CloudflareBindingLayers";
import { handleCloudflareEmailRoutingMessage } from "./CloudflareEmailRoutingIntegration";
import { LegacyMailDomainClaimStoreD1Layer } from "./LegacyMailDomainClaimD1Integration";
import { cacheSuccessfulInitialization } from "./SuccessfulInitialization";

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
      ALCHEMY_DEV,
      MAILBOX_OUTBOUND_PROVIDER_DISABLED: ALCHEMY_DEV,
    },
  },
  Effect.gen(function* () {
    // Acquire infrastructure handles shared by HTTP and Email Routing.
    const controlPlaneD1 = yield* Cloudflare.D1.QueryDatabase(
      ControlPlaneDatabaseResource
    );
    const rawMessages = yield* Cloudflare.R2.ReadWriteBucket(RawMessagesBucket);
    const authRateLimit = yield* RateLimitDurableObject;
    const mailboxDataPlane = yield* MailboxDO;
    const inboundWorkflow = yield* InboundWorkflow;
    const emailRouting = yield* EmailRoutingEventSource;
    const isDevelopment = process.env.ALCHEMY_DEV === "true";

    // Decode immutable deployment configuration before assembling adapters.
    const authEnvironment = yield* authRuntimeEnvironmentConfig;
    const aiInferenceLayer = yield* backendAiInferenceLayer(isDevelopment);
    let mailboxEmailSendBinding: Cloudflare.Email.SendClient | undefined;
    if (!isDevelopment) {
      mailboxEmailSendBinding =
        yield* Cloudflare.Email.Send(MailboxEmailSender);
    }
    let otlpBaseUrl: string | undefined;
    if (isDevelopment) {
      otlpBaseUrl = Option.getOrUndefined(
        authEnvironment.otlpExporterOtlpEndpoint
      );
    }
    const bootstrapConfig = yield* mailboxBootstrapConfig.pipe(Effect.orDie);
    const archiveConfig = yield* mailboxArchiveConfig(
      bootstrapConfig.initialDomain
    ).pipe(Effect.orDie);
    let delivery: AuthRuntimeConfigShape["delivery"] = {
      _tag: "development",
    };
    if (!isDevelopment) {
      delivery = {
        _tag: "production",
        emailSender: yield* Cloudflare.Email.Send(AuthEmailSender),
      };
    }
    const authRuntimeConfig = yield* makeAuthRuntimeConfig(authEnvironment, {
      delivery,
      rateLimitNamespace: authRateLimit,
    }).pipe(Effect.orDie);

    // Adapt raw Cloudflare handles to the application's focused ports.
    const authConfigLayer = authRuntimeConfigLayer(authRuntimeConfig);
    const workflowClientLayer = inboundWorkflowClientLayer(inboundWorkflow);
    const inboundAttachmentClientLayer =
      inboundAttachmentR2ReadClientLayer(rawMessages);
    const draftAttachmentClientLayer =
      draftAttachmentR2ClientLayer(rawMessages);
    const outboundAttachmentClientLayer =
      outboundDraftAttachmentR2ReadClientLayer(rawMessages);
    const outboundProviderLayer = mailboxOutboundProviderLayer(
      mailboxEmailSendBinding
    );
    const mailboxBootstrapConfigLayer = Layer.succeed(
      MailboxBootstrapConfig,
      MailboxBootstrapConfig.of(bootstrapConfig)
    );
    const healthBindingsLayer = backendHealthBindingsLayer({
      authRateLimit,
      isDevelopment,
      mailboxDataPlane,
      rawMessages,
    });

    // Complete runtime dependencies consumed by the private HTTP API.
    const backendHttpDependenciesLayer = Layer.mergeAll(
      authConfigLayer,
      workflowClientLayer,
      inboundAttachmentClientLayer,
      draftAttachmentClientLayer,
      outboundAttachmentClientLayer,
      outboundProviderLayer,
      aiInferenceLayer,
      Layer.succeed(
        MailboxArchiveConfig,
        MailboxArchiveConfig.of(archiveConfig)
      ),
      mailboxBootstrapConfigLayer,
      mailboxDoNamespaceLayer(mailboxDataPlane),
      healthBindingsLayer,
      Layer.succeed(DevEmailConfig, DevEmailConfig.of({ isDevelopment }))
    );

    // Reconcile the legacy route exactly once before accepting external work.
    const initializeLegacyMailDomainClaim =
      yield* cacheSuccessfulInitialization(
        Effect.gen(function* () {
          const controlPlaneDatabase = yield* controlPlaneD1.raw.pipe(
            Effect.provide(RuntimeContext.phantom)
          );
          const controlPlaneD1Layer = Layer.succeed(
            ControlPlaneD1Binding,
            ControlPlaneD1Binding.of({ database: controlPlaneDatabase })
          );
          const reconciliationLayer =
            LegacyMailDomainClaimReconciler.layerNoDeps.pipe(
              Layer.provide(LegacyMailDomainClaimStoreD1Layer),
              Layer.provide(ControlPlaneD1Layer),
              Layer.provide(controlPlaneD1Layer),
              Layer.provide(mailboxBootstrapConfigLayer)
            );
          const reconciler = yield* LegacyMailDomainClaimReconciler.pipe(
            Effect.provide(reconciliationLayer)
          );
          yield* reconciler.initialize.pipe(Effect.orDie);
        })
      );
    const backendRequestCompletionContext = yield* Layer.build(
      BackendRequestCompletionLayer
    );
    const backendRequestObservabilityLayer = backendObservabilityLayer({
      isDevelopment,
      otlpBaseUrl,
    });

    // Register the inbound Email Routing entry point and its focused graph.
    yield* emailRouting.listen((message) =>
      Effect.gen(function* () {
        yield* initializeLegacyMailDomainClaim;
        const controlPlaneDatabase = yield* controlPlaneD1.raw;
        const emailControlPlaneDatabaseLayer = ControlPlaneDatabaseLayer.pipe(
          Layer.provide(
            Layer.succeed(
              ControlPlaneD1Binding,
              ControlPlaneD1Binding.of({ database: controlPlaneDatabase })
            )
          )
        );
        const inboundRawMessagesLayer =
          inboundRawMessageR2WriteClientLayer(rawMessages);
        const inboundWorkflowStarterLayer =
          InboundWorkflowStarterCloudflareLayer.pipe(
            Layer.provide(workflowClientLayer)
          );
        const inboundRawMessageStoreLayer = InboundRawMessageStoreR2Layer.pipe(
          Layer.provide(
            Layer.merge(
              inboundRawMessagesLayer,
              InboundRawMessageStoreRuntimeCloudflareLayer
            )
          )
        );
        const inboundEmailIngressLayer =
          MailboxInboundEmailIngress.layerNoDeps.pipe(
            Layer.provide(
              Layer.mergeAll(
                inboundRawMessageStoreLayer,
                MailboxInboundEmailIngressRuntimeSystemLayer,
                inboundWorkflowStarterLayer
              )
            )
          );
        const inboundEmailApplicationLayer = Layer.mergeAll(
          AddressRoutingLayer.pipe(
            Layer.provide(emailControlPlaneDatabaseLayer)
          ),
          inboundEmailIngressLayer,
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
          Effect.provide(inboundEmailApplicationLayer)
        );
      })
    );
    // Serve the complete private HTTP API with request-scoped D1 and tracing.
    return {
      fetch: Effect.gen(function* () {
        const startedAtNanos = yield* Clock.currentTimeNanos;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const requestUrl = new URL(request.url, authRuntimeConfig.publicOrigin);
        const applicationKind = backendHttpApplicationKind(
          request.method,
          requestUrl.pathname
        );
        if (applicationKind === "aggregate") {
          yield* initializeLegacyMailDomainClaim;
        }
        const requestContext = backendRequestContext(request.headers["cf-ray"]);
        const completion = yield* BackendRequestCompletion.pipe(
          Effect.provide(backendRequestCompletionContext)
        );
        // Building in Alchemy's request scope flushes OTLP finalizers through waitUntil.
        const observabilityExit = yield* Layer.build(
          backendRequestObservabilityLayer
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
            const controlPlaneDatabase = yield* controlPlaneD1.raw;
            const requestControlPlaneD1Layer = Layer.succeed(
              ControlPlaneD1Binding,
              ControlPlaneD1Binding.of({ database: controlPlaneDatabase })
            );
            const requestContextLayer = Layer.succeed(
              CurrentBackendRequestContext,
              CurrentBackendRequestContext.of(requestContext)
            );
            const applicationLayer =
              applicationKind === "health"
                ? BackendHealthApplicationLayer
                : applicationKind === "session"
                  ? BackendAuthSessionApplicationLayer
                  : applicationKind === "magic-link-start"
                    ? BackendMagicLinkStartApplicationLayer
                    : BackendApplicationLayer;
            const handler = yield* HttpRouter.toHttpEffect(
              applicationLayer.pipe(
                Layer.provide(requestControlPlaneD1Layer),
                Layer.provide(backendHttpDependenciesLayer),
                Layer.provide(requestContextLayer),
                Layer.orDie
              )
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
    Effect.provide(
      Layer.mergeAll(
        EmailRoutingEventSourceCloudflareLayer,
        Cloudflare.AI.QueryGatewayBinding,
        Cloudflare.D1.QueryDatabaseBinding,
        Cloudflare.Email.SendBinding,
        Cloudflare.R2.ReadWriteBucketBinding
      )
    )
  )
) {}
