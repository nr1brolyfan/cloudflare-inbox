import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AdministrativeAuditRuntime } from "../ports/AdministrativeAuditRuntime";

export const AdministrativeAuditRuntimeLayer = Layer.succeed(
  AdministrativeAuditRuntime,
  AdministrativeAuditRuntime.of({
    digestSha256: (value) =>
      Effect.promise(() =>
        crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
      ).pipe(
        Effect.map((digest) =>
          [...new Uint8Array(digest)]
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("")
        )
      ),
  })
);
