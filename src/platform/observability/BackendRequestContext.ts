import * as Schema from "effect/Schema";

import {
  BackendCorrelationId,
  BackendRequestContext,
  BackendRequestId,
  CloudflareRayId,
} from "#/shared/BackendRequestContext";

/** Generates server-owned identity and accepts only bounded Cloudflare metadata. */
export const backendRequestContext = (
  cloudflareRay?: string
): BackendRequestContext => {
  const requestId = Schema.decodeUnknownSync(BackendRequestId)(
    crypto.randomUUID()
  );
  const cloudflareRayId =
    cloudflareRay === undefined || !Schema.is(CloudflareRayId)(cloudflareRay)
      ? undefined
      : cloudflareRay;

  return Schema.decodeUnknownSync(BackendRequestContext)({
    cloudflareColo: cloudflareRayId?.slice(-3),
    cloudflareRayId,
    correlationId: Schema.decodeUnknownSync(BackendCorrelationId)(requestId),
    requestId,
  });
};

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
