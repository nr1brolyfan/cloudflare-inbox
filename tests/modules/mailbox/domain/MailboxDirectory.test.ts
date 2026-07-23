import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  CreateFolderInput,
  Folder,
  FolderSchema,
} from "#/modules/mailbox/domain/MailboxDirectory";

const decodeSucceeds = <S extends Schema.ConstraintDecoder<unknown, never>>(
  schema: S,
  input: unknown
) => Exit.isSuccess(Schema.decodeUnknownExit(schema)(input));

describe("mailbox directory contracts", () => {
  it("constructs and encodes schema-backed directory entities", () => {
    const folder = Schema.decodeUnknownSync(Folder)({
      id: "projects",
      mailboxId: "primary",
      name: "  Projects  ",
      kind: "custom",
      createdAt: 1000,
      updatedAt: 1000,
      version: 1,
    });

    expect(folder).toBeInstanceOf(Folder);
    expect(folder.name).toBe("Projects");
    expect(Schema.encodeSync(Folder)(folder)).toStrictEqual({
      id: "projects",
      mailboxId: "primary",
      name: "Projects",
      kind: "custom",
      createdAt: 1000,
      updatedAt: 1000,
      version: 1,
    });
    expect(
      decodeSucceeds(FolderSchema, {
        ...Schema.encodeSync(Folder)(folder),
        createdAt: 2000,
      })
    ).toBeFalsy();
  });

  it("defines an idempotent public folder command", () => {
    expect(
      Schema.decodeUnknownSync(CreateFolderInput)({
        mailboxId: "primary",
        operationId: "create-projects",
        name: " Projects ",
      })
    ).toMatchObject({ name: "Projects" });
  });
});
