import * as Schema from "effect/Schema";

import { OutboundFailureCode } from "./outbound-failure-code";
import { UnixMillis } from "./primitives";

export class OutboundDeliveryFailure extends Schema.Class<OutboundDeliveryFailure>(
  "cloudflare-inbox/OutboundDeliveryFailure"
)({
  code: OutboundFailureCode,
  failedAt: UnixMillis,
}) {}
