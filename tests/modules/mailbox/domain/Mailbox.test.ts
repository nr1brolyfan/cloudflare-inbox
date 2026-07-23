import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { MailboxId, PageSize } from "#/modules/mailbox/domain/Mailbox";
import { Version } from "#/shared/Temporal";

const decodeSucceeds = <S extends Schema.ConstraintDecoder<unknown, never>>(
  schema: S,
  input: unknown
) => Exit.isSuccess(Schema.decodeUnknownExit(schema)(input));

describe("mailbox contracts", () => {
  it("validates branded identifiers, versions, and page sizes", () => {
    expect([
      decodeSucceeds(MailboxId, "primary"),
      decodeSucceeds(MailboxId, " primary "),
      decodeSucceeds(Version, 1),
      decodeSucceeds(Version, 0),
      decodeSucceeds(PageSize, 100),
      decodeSucceeds(PageSize, 101),
    ]).toStrictEqual([true, false, true, false, true, false]);
  });
});
