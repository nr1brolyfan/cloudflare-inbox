import * as Schema from "effect/Schema";

export const UnixMillis = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
  Schema.brand("cloudflare-inbox/UnixMillis")
);
export type UnixMillis = Schema.Schema.Type<typeof UnixMillis>;
