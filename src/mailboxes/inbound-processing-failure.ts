import * as Schema from "effect/Schema";

import { InboundFailureCode } from "./inbound-failure-code";
import { UnixMillis } from "./primitives";

export class InboundProcessingFailure extends Schema.Class<InboundProcessingFailure>(
  "cloudflare-inbox/InboundProcessingFailure"
)({
  code: InboundFailureCode,
  failedAt: UnixMillis,
  replayable: Schema.Boolean,
}) {}
