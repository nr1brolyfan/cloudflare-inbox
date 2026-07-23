import * as Schema from "effect/Schema";

export const UnixMillis = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
  Schema.brand("cloudflare-inbox/UnixMillis")
);
export type UnixMillis = Schema.Schema.Type<typeof UnixMillis>;

export const Version = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1)),
  Schema.brand("cloudflare-inbox/Version")
);
export type Version = Schema.Schema.Type<typeof Version>;
