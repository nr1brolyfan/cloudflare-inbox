import * as Context from "effect/Context";
import * as Schema from "effect/Schema";

const UuidV4 = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    )
  )
);

export const RequestId = UuidV4.pipe(
  Schema.brand("cloudflare-inbox/RequestId")
);
export type RequestId = Schema.Schema.Type<typeof RequestId>;

export const CorrelationId = UuidV4.pipe(
  Schema.brand("cloudflare-inbox/CorrelationId")
);
export type CorrelationId = Schema.Schema.Type<typeof CorrelationId>;

export class RequestCorrelation extends Schema.Class<RequestCorrelation>(
  "cloudflare-inbox/RequestCorrelation"
)({
  correlationId: CorrelationId,
  requestId: RequestId,
}) {}

/** Neutral request identity available throughout one server invocation. */
export const CurrentRequestCorrelation = Context.Service<RequestCorrelation>(
  "cloudflare-inbox/CurrentRequestCorrelation"
);
