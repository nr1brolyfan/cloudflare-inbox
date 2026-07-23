import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  EmailAddress,
  NormalizedEmailAddress,
  normalizeEmailAddressDomain,
} from "#/shared/EmailAddress";

const decodeSucceeds = <S extends Schema.ConstraintDecoder<unknown, never>>(
  schema: S,
  input: unknown
) => Exit.isSuccess(Schema.decodeUnknownExit(schema)(input));

describe("email address", () => {
  it("validates email address syntax", () => {
    expect([
      decodeSucceeds(EmailAddress, "owner@example.com"),
      decodeSucceeds(EmailAddress, "owner@example."),
      decodeSucceeds(EmailAddress, "a..b@example.com"),
      decodeSucceeds(EmailAddress, "a@-example.com"),
      decodeSucceeds(EmailAddress, "a@example-.com"),
      decodeSucceeds(EmailAddress, "a@exa_mple.com"),
    ]).toStrictEqual([true, false, false, false, false, false]);
  });

  it("normalizes domains without folding SMTP local parts", () => {
    expect(
      normalizeEmailAddressDomain(
        Schema.decodeUnknownSync(EmailAddress)("Owner@EXAMPLE.COM")
      )
    ).toBe("Owner@example.com");
    expect(
      decodeSucceeds(NormalizedEmailAddress, "Owner@EXAMPLE.COM")
    ).toBeFalsy();
    expect(
      decodeSucceeds(NormalizedEmailAddress, "Owner@example.com")
    ).toBeTruthy();
  });
});
