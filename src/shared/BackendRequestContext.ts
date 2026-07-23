import * as Context from "effect/Context";
import * as Schema from "effect/Schema";

const UuidV4 = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    )
  )
);

export const BackendRequestId = UuidV4.pipe(
  Schema.brand("cloudflare-inbox/BackendRequestId")
);
export type BackendRequestId = Schema.Schema.Type<typeof BackendRequestId>;

export const BackendCorrelationId = UuidV4.pipe(
  Schema.brand("cloudflare-inbox/BackendCorrelationId")
);
export type BackendCorrelationId = Schema.Schema.Type<
  typeof BackendCorrelationId
>;

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
  correlationId: BackendCorrelationId,
  requestId: BackendRequestId,
}) {}

/** Request identity available throughout one Backend router invocation. */
export const CurrentBackendRequestContext =
  Context.Service<BackendRequestContext>(
    "cloudflare-inbox/CurrentBackendRequestContext"
  );
