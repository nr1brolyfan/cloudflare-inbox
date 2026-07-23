import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  MailboxDoClient,
  MailboxDoClientLayer,
  MailboxDoNamespace,
} from "#/modules/mailbox/adapters/durable-object/MailboxDoClient";
import {
  MailboxDirectoryRepositoryDoLayer,
  MailboxDraftRepositoryDoLayer,
} from "#/modules/mailbox/adapters/durable-object/MailboxRepositoryDo";
import { FolderId, MailboxId } from "#/modules/mailbox/domain/Mailbox";
import { CreateFolderInput } from "#/modules/mailbox/domain/MailboxDirectory";
import { CreateDraftInput } from "#/modules/mailbox/domain/MailboxDraft";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import { MailboxDirectoryRepository } from "#/modules/mailbox/ports/MailboxDirectoryRepository";
import { MailboxDraftRepository } from "#/modules/mailbox/ports/MailboxDraftRepository";
import { MailboxRegistry } from "#/modules/mailbox/ports/MailboxRegistry";
import { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";

const unusedRpc = () => Effect.die(new Error("RPC is unused"));

const findFolder = (
  mailboxExists: boolean,
  resolveMailResource: (input: unknown) => Effect.Effect<unknown>
) => {
  const addressedNames: string[] = [];
  const clientLayer = MailboxDoClientLayer.pipe(
    Layer.provide(
      Layer.merge(
        Layer.succeed(
          MailboxRegistry,
          MailboxRegistry.of({
            exists: () => Effect.succeed(mailboxExists),
          })
        ),
        Layer.succeed(
          MailboxDoNamespace,
          MailboxDoNamespace.of({
            getByName: (name) => {
              addressedNames.push(name);
              return {
                executeMailData: unusedRpc,
                executeDirectory: unusedRpc,
                resolveMailResource,
              };
            },
          })
        )
      )
    )
  );
  const effect = Effect.gen(function* () {
    const client = yield* MailboxDoClient;
    return yield* client.resolveMailResource({
      _tag: "Folder",
      mailboxId: Schema.decodeUnknownSync(MailboxId)("mailbox-a"),
      folderId: Schema.decodeUnknownSync(FolderId)("folder-a"),
    });
  }).pipe(Effect.provide(clientLayer));

  return { addressedNames, effect };
};

const createFolderThroughRpc = (
  response: (input: unknown) => Effect.Effect<unknown>,
  mailboxExists = true
) => {
  const requests: unknown[] = [];
  const addressedNames: string[] = [];
  const clientLayer = MailboxDoClientLayer.pipe(
    Layer.provide(
      Layer.merge(
        Layer.succeed(
          MailboxRegistry,
          MailboxRegistry.of({
            exists: () => Effect.succeed(mailboxExists),
          })
        ),
        Layer.succeed(
          MailboxDoNamespace,
          MailboxDoNamespace.of({
            getByName: (name) => {
              addressedNames.push(name);
              return {
                executeMailData: unusedRpc,
                executeDirectory: (input) => {
                  requests.push(input);
                  return response(input);
                },
                resolveMailResource: unusedRpc,
              };
            },
          })
        )
      )
    )
  );
  const live = MailboxDirectoryRepositoryDoLayer.pipe(
    Layer.provide(clientLayer)
  );
  const effect = Effect.gen(function* () {
    const repository = yield* MailboxDirectoryRepository;
    return yield* repository.createFolder(
      Schema.decodeUnknownSync(CreateFolderInput)({
        mailboxId: "mailbox-a",
        operationId: "create-projects",
        name: " Projects ",
      })
    );
  }).pipe(Effect.provide(live));

  return { addressedNames, effect, requests };
};

const createDraftThroughRpc = (
  response: (input: unknown) => Effect.Effect<unknown>,
  mailboxExists = true
) => {
  const requests: unknown[] = [];
  const addressedNames: string[] = [];
  const clientLayer = MailboxDoClientLayer.pipe(
    Layer.provide(
      Layer.merge(
        Layer.succeed(
          MailboxRegistry,
          MailboxRegistry.of({
            exists: () => Effect.succeed(mailboxExists),
          })
        ),
        Layer.succeed(
          MailboxDoNamespace,
          MailboxDoNamespace.of({
            getByName: (name) => {
              addressedNames.push(name);
              return {
                executeDirectory: unusedRpc,
                executeMailData: (input) => {
                  requests.push(input);
                  return response(input);
                },
                resolveMailResource: unusedRpc,
              };
            },
          })
        )
      )
    )
  );
  const live = MailboxDraftRepositoryDoLayer.pipe(Layer.provide(clientLayer));
  const effect = Effect.gen(function* () {
    const repository = yield* MailboxDraftRepository;
    return yield* repository.createDraft(
      Schema.decodeUnknownSync(CreateDraftInput)({
        mailboxId: "mailbox-a",
        operationId: "draft-op",
        content: {
          to: [{ address: "to@example.com" }],
          cc: [],
          bcc: [],
          subject: "Draft",
          attachmentIds: [],
        },
      })
    );
  }).pipe(Effect.provide(live));

  return { addressedNames, effect, requests };
};

describe("MailboxDO repository RPC adapter", () => {
  it("does not materialize a Durable Object for a missing mailbox", async () => {
    const fixture = findFolder(false, () =>
      Effect.die(new Error("RPC should not be called"))
    );

    const result = await Effect.runPromise(fixture.effect);

    expect(result).toStrictEqual({ _tag: "NotFound" });
    expect(fixture.addressedNames).toStrictEqual([]);
  });

  it("validates a found response from the selected mailbox", async () => {
    const fixture = findFolder(true, () =>
      Effect.succeed({
        _tag: "Folder",
        mailboxId: "mailbox-a",
        folderId: "folder-a",
      })
    );

    const result = await Effect.runPromise(fixture.effect);

    expect(result).toStrictEqual({
      _tag: "Folder",
      mailboxId: "mailbox-a",
      folderId: "folder-a",
    });
    expect(fixture.addressedNames).toStrictEqual(["mailbox-a"]);
  });

  it("preserves RPC interruption", async () => {
    const fixture = findFolder(true, () => Effect.interrupt);
    const exit = await Effect.runPromiseExit(fixture.effect);

    expect(Exit.isFailure(exit)).toBeTruthy();
    expect(
      Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
    ).toBeTruthy();
  });

  it("validates successful directory DTOs", async () => {
    const fixture = createFolderThroughRpc(() =>
      Effect.succeed({
        _tag: "FolderCreated",
        value: {
          id: "folder-projects",
          mailboxId: "mailbox-a",
          name: "Projects",
          kind: "custom",
          createdAt: 1000,
          updatedAt: 1000,
          version: 1,
        },
      })
    );

    await expect(Effect.runPromise(fixture.effect)).resolves.toMatchObject({
      id: "folder-projects",
      name: "Projects",
    });
    expect(fixture.requests).toStrictEqual([
      {
        _tag: "CreateFolder",
        input: {
          mailboxId: "mailbox-a",
          operationId: "create-projects",
          name: "Projects",
        },
      },
    ]);
  });

  it("reconstructs domain failures from plain RPC DTOs", async () => {
    const fixture = createFolderThroughRpc(() =>
      Effect.succeed({
        _tag: "DomainError",
        operation: "create-folder",
        reason: "idempotency-conflict",
        message: "Operation ID was already used",
        resourceId: "create-projects",
      })
    );
    const error = await Effect.runPromise(fixture.effect.pipe(Effect.flip));

    expect(error).toBeInstanceOf(MailboxDomainError);
    expect(error).toMatchObject({
      operation: "create-folder",
      reason: "idempotency-conflict",
      resourceId: "create-projects",
    });
  });

  it("preserves interruption from directory RPC", async () => {
    const fixture = createFolderThroughRpc(() => Effect.interrupt);
    const exit = await Effect.runPromiseExit(fixture.effect);

    expect(Exit.isFailure(exit)).toBeTruthy();
    expect(
      Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
    ).toBeTruthy();
  });

  it("rejects a valid response for the wrong directory operation", async () => {
    const fixture = createFolderThroughRpc(() =>
      Effect.succeed({ _tag: "LabelsListed", value: { items: [] } })
    );
    const error = await Effect.runPromise(fixture.effect.pipe(Effect.flip));

    expect(error).toBeInstanceOf(MailboxRepositoryError);
    expect(error).toMatchObject({
      operation: "write",
      commitState: "unknown",
    });
  });

  it("checks mailbox existence before unified directory RPC", async () => {
    const fixture = createFolderThroughRpc(
      () => Effect.die(new Error("RPC should not be called")),
      false
    );
    const error = await Effect.runPromise(fixture.effect.pipe(Effect.flip));

    expect(error).toBeInstanceOf(MailboxDomainError);
    expect(error).toMatchObject({
      operation: "create-folder",
      reason: "not-found",
      resourceType: "mailbox",
    });
    expect(fixture.addressedNames).toStrictEqual([]);
  });

  it("maps unified mail data success and domain DTOs", async () => {
    const value = {
      id: "draft-1",
      mailboxId: "mailbox-a",
      to: [{ address: "to@example.com" }],
      cc: [],
      bcc: [],
      subject: "Draft",
      attachmentIds: [],
      createdAt: 1000,
      updatedAt: 1000,
      version: 1,
    };
    const successful = createDraftThroughRpc(() =>
      Effect.succeed({ _tag: "DraftCreated", value })
    );
    const failed = createDraftThroughRpc(() =>
      Effect.succeed({
        _tag: "DomainError",
        operation: "create-draft",
        reason: "idempotency-conflict",
        message: "Conflict",
      })
    );

    await expect(Effect.runPromise(successful.effect)).resolves.toMatchObject({
      id: "draft-1",
    });
    await expect(
      Effect.runPromise(failed.effect.pipe(Effect.flip))
    ).resolves.toBeInstanceOf(MailboxDomainError);
    expect(successful.requests[0]).toMatchObject({ _tag: "CreateDraft" });
  });

  it("rejects mail data protocol mismatch and preserves interruption", async () => {
    const mismatch = createDraftThroughRpc(() =>
      Effect.succeed({ _tag: "MessagesListed", value: { items: [] } })
    );
    const interrupted = createDraftThroughRpc(() => Effect.interrupt);
    const mismatchError = await Effect.runPromise(
      mismatch.effect.pipe(Effect.flip)
    );
    const interruptedExit = await Effect.runPromiseExit(interrupted.effect);

    expect(mismatchError).toMatchObject({
      _tag: "MailboxRepositoryError",
      operation: "write",
      commitState: "unknown",
    });
    expect(
      Exit.isFailure(interruptedExit) &&
        Cause.hasInterruptsOnly(interruptedExit.cause)
    ).toBeTruthy();
  });

  it("checks mailbox existence before unified mail data RPC", async () => {
    const fixture = createDraftThroughRpc(
      () => Effect.die(new Error("RPC should not be called")),
      false
    );
    const error = await Effect.runPromise(fixture.effect.pipe(Effect.flip));

    expect(error).toMatchObject({
      _tag: "MailboxDomainError",
      operation: "create-draft",
      reason: "not-found",
    });
    expect(fixture.addressedNames).toStrictEqual([]);
  });
});
