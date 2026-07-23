import * as Schema from "effect/Schema";

export const OperationId = Schema.Trimmed.pipe(
  Schema.check(Schema.isLengthBetween(1, 128)),
  Schema.brand("cloudflare-inbox/OperationId")
);
export type OperationId = Schema.Schema.Type<typeof OperationId>;

export const AdministrativeOperationId = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    )
  ),
  Schema.brand("cloudflare-inbox/AdministrativeOperationId")
);
export type AdministrativeOperationId = Schema.Schema.Type<
  typeof AdministrativeOperationId
>;
