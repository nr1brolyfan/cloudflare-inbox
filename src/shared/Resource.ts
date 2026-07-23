import * as Schema from "effect/Schema";

export const ResourceId = Schema.Trimmed.pipe(
  Schema.check(Schema.isLengthBetween(1, 128))
);
export type ResourceId = Schema.Schema.Type<typeof ResourceId>;
