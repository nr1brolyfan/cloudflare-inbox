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

const signalUrl = (baseUrl: string, signal: "logs" | "traces") =>
  new URL(
    `v1/${signal}`,
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  ).toString();

export const makeBackendObservabilityLive = (
  options: BackendObservabilityOptions
): Layer.Layer<never> => {
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
};
