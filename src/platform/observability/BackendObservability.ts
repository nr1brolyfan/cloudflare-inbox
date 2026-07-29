import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as OtlpLogger from "effect/unstable/observability/OtlpLogger";
import * as OtlpSerialization from "effect/unstable/observability/OtlpSerialization";
import * as OtlpTracer from "effect/unstable/observability/OtlpTracer";

export interface BackendObservabilityOptions {
  readonly isDevelopment: boolean;
  readonly otlpBaseUrl?: string;
}

/** Selects Cloudflare production logging or local OTLP export. */
export const BackendObservabilityConfig =
  Context.Service<BackendObservabilityOptions>(
    "cloudflare-inbox/BackendObservabilityConfig"
  );

const signalUrl = (baseUrl: string, signal: "logs" | "traces") =>
  new URL(
    `v1/${signal}`,
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  ).toString();

/** Request-scoped logging and tracing; its scope flushes through Alchemy waitUntil. */
export const BackendObservabilityLayer = Layer.unwrap(
  Effect.gen(function* () {
    const options = yield* BackendObservabilityConfig;
    if (!options.isDevelopment) {
      return Logger.layer([Logger.consoleStructured]);
    }

    if (options.otlpBaseUrl === undefined) {
      return Layer.empty;
    }

    const resource = {
      serviceName: "cloudflare-inbox-backend",
      attributes: {
        "deployment.environment.name": "local",
      },
    };

    return Layer.merge(
      OtlpLogger.layer({
        exportInterval: "1 second",
        mergeWithExisting: true,
        resource,
        shutdownTimeout: "1 second",
        url: signalUrl(options.otlpBaseUrl, "logs"),
      }),
      OtlpTracer.layer({
        exportInterval: "1 second",
        resource,
        shutdownTimeout: "1 second",
        url: signalUrl(options.otlpBaseUrl, "traces"),
      })
    ).pipe(
      Layer.provide(OtlpSerialization.layerJson),
      Layer.provide(FetchHttpClient.layer)
    );
  })
);

/** Supplies deployment options to the request-scoped observability graph. */
export const backendObservabilityLayer = (
  options: BackendObservabilityOptions
) =>
  BackendObservabilityLayer.pipe(
    Layer.provide(
      Layer.succeed(
        BackendObservabilityConfig,
        BackendObservabilityConfig.of(options)
      )
    )
  );
