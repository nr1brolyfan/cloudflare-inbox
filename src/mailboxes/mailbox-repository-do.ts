import { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { MailboxRepositoryError } from "./errors/mailbox-repository-error";
import {
  MailboxRepository,
  MailboxResourceLookup,
  MailboxResourceLookupResult,
} from "./mailbox-repository";
import type {
  MailboxResourceLookup as MailboxResourceLookupType,
  MailboxResourceLookupResult as MailboxResourceLookupResultType,
} from "./mailbox-repository";

export interface MailboxRepositoryDoConfig {
  readonly mailboxExists: (
    mailboxId: MailboxResourceLookupType["mailboxId"]
  ) => Effect.Effect<boolean, unknown>;
  readonly namespace: {
    readonly getByName: (name: string) => {
      readonly resolveMailResource: (
        input: unknown
      ) => Effect.Effect<unknown, unknown, RuntimeContext>;
    };
  };
}

/** Cloudflare namespace used by the Worker-side repository adapter. */
export const MailboxRepositoryDoConfig =
  Context.Service<MailboxRepositoryDoConfig>(
    "cloudflare-inbox/MailboxRepositoryDoConfig"
  );

const repositoryError = (message: string, cause: unknown) =>
  new MailboxRepositoryError({
    cause,
    commitState: "not-committed",
    message,
    operation: "read",
  });

/** Routes trusted resource reads to the SQLite database owned by each MailboxDO. */
export const MailboxRepositoryDoLive = Layer.effect(
  MailboxRepository,
  Effect.gen(function* () {
    const config = yield* MailboxRepositoryDoConfig;
    const notFound: MailboxResourceLookupResultType = { _tag: "NotFound" };
    const lookup = (request: MailboxResourceLookupType) =>
      Effect.try({
        try: () => Schema.encodeSync(MailboxResourceLookup)(request),
        catch: (cause) => repositoryError("Invalid mailbox lookup", cause),
      }).pipe(
        Effect.flatMap((encoded) =>
          config.mailboxExists(request.mailboxId).pipe(
            Effect.mapError((cause) =>
              repositoryError("Mailbox registry lookup failed", cause)
            ),
            Effect.catchDefect((cause) =>
              Effect.fail(
                repositoryError("Mailbox registry lookup failed", cause)
              )
            ),
            Effect.flatMap((exists) =>
              exists
                ? config.namespace
                    .getByName(request.mailboxId)
                    .resolveMailResource(encoded)
                    .pipe(
                      Effect.provide(RuntimeContext.phantom),
                      Effect.mapError((cause) =>
                        repositoryError("Mailbox resource lookup failed", cause)
                      ),
                      Effect.catchDefect((cause) =>
                        Effect.fail(
                          repositoryError(
                            "Mailbox resource lookup failed",
                            cause
                          )
                        )
                      )
                    )
                : Effect.succeed(notFound)
            )
          )
        ),
        Effect.flatMap((response) =>
          Effect.try({
            try: () =>
              Schema.decodeUnknownSync(MailboxResourceLookupResult)(response),
            catch: (cause) =>
              repositoryError("Mailbox lookup returned invalid data", cause),
          })
        )
      );
    const wrongResource = (result: unknown) =>
      Effect.fail(
        repositoryError(
          "Mailbox lookup returned the wrong resource type",
          result
        )
      );

    return MailboxRepository.of({
      findAttachmentLocation: (input) =>
        lookup({ _tag: "Attachment", ...input }).pipe(
          Effect.flatMap((result) => {
            if (result._tag === "NotFound") {
              return Effect.succeed(Option.none());
            }
            return result._tag === "Attachment"
              ? Effect.succeed(Option.some(result))
              : wrongResource(result);
          })
        ),
      findDraftLocation: (input) =>
        lookup({ _tag: "Draft", ...input }).pipe(
          Effect.flatMap((result) => {
            if (result._tag === "NotFound") {
              return Effect.succeed(Option.none());
            }
            return result._tag === "Draft"
              ? Effect.succeed(Option.some(result))
              : wrongResource(result);
          })
        ),
      findFolderLocation: (input) =>
        lookup({ _tag: "Folder", ...input }).pipe(
          Effect.flatMap((result) => {
            if (result._tag === "NotFound") {
              return Effect.succeed(Option.none());
            }
            return result._tag === "Folder"
              ? Effect.succeed(Option.some(result))
              : wrongResource(result);
          })
        ),
      findMessageLocation: (input) =>
        lookup({ _tag: "Message", ...input }).pipe(
          Effect.flatMap((result) => {
            if (result._tag === "NotFound") {
              return Effect.succeed(Option.none());
            }
            return result._tag === "Message"
              ? Effect.succeed(Option.some(result))
              : wrongResource(result);
          })
        ),
      findRuleLocation: (input) =>
        lookup({ _tag: "Rule", ...input }).pipe(
          Effect.flatMap((result) => {
            if (result._tag === "NotFound") {
              return Effect.succeed(Option.none());
            }
            return result._tag === "Rule"
              ? Effect.succeed(Option.some(result))
              : wrongResource(result);
          })
        ),
    });
  })
);
