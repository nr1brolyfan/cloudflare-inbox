import * as Schema from "effect/Schema";

import { MailAddress } from "#/modules/address-routing/domain/MailAddress";

export const AddressList = Schema.Array(MailAddress);
export const StringList = Schema.Array(Schema.String);

export const encodeJson = <A, I>(schema: Schema.Codec<A, I>, value: A) =>
  JSON.stringify(Schema.encodeSync(schema)(value));

export const decodeJson = <A>(schema: Schema.Decoder<A>, value: string) =>
  Schema.decodeUnknownSync(schema)(JSON.parse(value));

export const optionalAddress = (value: string | null) =>
  value === null ? undefined : decodeJson(MailAddress, value);
