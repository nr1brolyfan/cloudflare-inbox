import * as Context from "effect/Context";
import * as Schema from "effect/Schema";

import {
  CorrelationId,
  RequestCorrelation,
  RequestId,
} from "#/shared/RequestCorrelation";

export const CloudflareRayId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[0-9a-f]{16}-[A-Z]{3}$/u)),
  Schema.brand("cloudflare-inbox/CloudflareRayId")
);
export const CloudflareColo = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Z]{3}$/u)),
  Schema.brand("cloudflare-inbox/CloudflareColo")
);

export class BackendRequestContext extends Schema.Class<BackendRequestContext>(
  "cloudflare-inbox/BackendRequestContext"
)({
  cloudflareColo: Schema.optional(CloudflareColo),
  cloudflareRayId: Schema.optional(CloudflareRayId),
  correlationId: CorrelationId,
  requestId: RequestId,
}) {}

export const CurrentBackendRequestContext =
  Context.Service<BackendRequestContext>(
    "cloudflare-inbox/CurrentBackendRequestContext"
  );

/** Generates server-owned identity and accepts only bounded Cloudflare metadata. */
export const backendRequestContext = (
  cloudflareRay?: string
): BackendRequestContext => {
  const requestId = Schema.decodeUnknownSync(RequestId)(crypto.randomUUID());
  const cloudflareRayId =
    cloudflareRay === undefined || !Schema.is(CloudflareRayId)(cloudflareRay)
      ? undefined
      : cloudflareRay;

  return Schema.decodeUnknownSync(BackendRequestContext)({
    cloudflareColo: cloudflareRayId?.slice(-3),
    cloudflareRayId,
    correlationId: Schema.decodeUnknownSync(CorrelationId)(requestId),
    requestId,
  });
};

export const requestCorrelation = (
  context: BackendRequestContext
): RequestCorrelation =>
  RequestCorrelation.make({
    correlationId: context.correlationId,
    requestId: context.requestId,
  });

export const backendRequestContextAnnotations = (
  context: BackendRequestContext
): Record<string, unknown> => ({
  ...(context.cloudflareColo === undefined
    ? {}
    : { "cloudflare.colo": context.cloudflareColo }),
  ...(context.cloudflareRayId === undefined
    ? {}
    : { "cloudflare.ray_id": context.cloudflareRayId }),
  "correlation.id": context.correlationId,
  "request.id": context.requestId,
});
