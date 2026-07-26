import type * as CloudflareWorkers from "@cloudflare/workers-types";
import type { D1EffectQbDatabaseLike } from "@effect-auth/core/EffectQbSqliteStorage";
import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { MailboxEmailSendClient } from "#/modules/mailbox/adapters/email/OutboundEmailProviderCloudflare";
import { OutboundDraftAttachmentR2ReadClient } from "#/modules/mailbox/adapters/r2/OutboundDraftAttachmentBlobReaderR2";
import { DeliveryProviderUnavailableError } from "#/modules/mailbox/ports/OutboundEmailProvider";

interface RawMessagesBinding {
  readonly get: (key: string) => Promise<CloudflareWorkers.R2ObjectBody | null>;
}

interface MailboxEmailBinding {
  readonly send: (
    message: CloudflareWorkers.EmailMessageBuilder
  ) => Promise<CloudflareWorkers.EmailSendResult>;
}

export interface MailboxDoBindingsShape {
  readonly email: Effect.Effect<
    MailboxEmailBinding,
    DeliveryProviderUnavailableError
  >;
  readonly controlPlane: Effect.Effect<D1EffectQbDatabaseLike>;
  readonly rawMessages: Effect.Effect<RawMessagesBinding>;
}

export class MailboxDoBindings extends Context.Service<
  MailboxDoBindings,
  MailboxDoBindingsShape
>()("cloudflare-inbox/MailboxDoBindings") {}

/** Adapts Alchemy binding clients without materializing runtime bindings at plan time. */
export const mailboxDoBindingsFromClients = (
  controlPlane: Cloudflare.D1.QueryDatabaseClient,
  rawMessages: Cloudflare.R2.ReadWriteBucketClient,
  email?: Cloudflare.Email.SendClient
): MailboxDoBindingsShape =>
  MailboxDoBindings.of({
    controlPlane: controlPlane.raw.pipe(Effect.provide(RuntimeContext.phantom)),
    rawMessages: rawMessages.raw.pipe(Effect.provide(RuntimeContext.phantom)),
    email:
      email === undefined
        ? Effect.fail(
            new DeliveryProviderUnavailableError({
              cause: new Error("MailboxEmail binding is disabled"),
              message: "Outbound email provider is unavailable",
            })
          )
        : email.raw.pipe(Effect.provide(RuntimeContext.phantom)),
  });

const isObject = (value: unknown): value is object =>
  typeof value === "object" && value !== null;

const hasMethod = (value: unknown, name: string): value is object =>
  isObject(value) && typeof Reflect.get(value, name) === "function";

const isRawMessagesBinding = (value: unknown): value is RawMessagesBinding =>
  hasMethod(value, "get");

const isMailboxEmailBinding = (value: unknown): value is MailboxEmailBinding =>
  hasMethod(value, "send");
const isControlPlaneBinding = (
  value: unknown
): value is D1EffectQbDatabaseLike =>
  hasMethod(value, "prepare") && hasMethod(value, "batch");

/** Captures the Worker environment while keeping optional binding access lazy. */
export const MailboxDoBindingsLayer = Layer.effect(
  MailboxDoBindings,
  Effect.gen(function* () {
    const workerEnvironment: unknown = yield* Cloudflare.WorkerEnvironment;
    return MailboxDoBindings.of({
      controlPlane: Effect.gen(function* () {
        if (!isObject(workerEnvironment)) {
          return yield* Effect.die(
            new Error("MailboxDO Worker environment is unavailable")
          );
        }
        const controlPlane: unknown = Reflect.get(
          workerEnvironment,
          "ControlPlane"
        );
        if (!isControlPlaneBinding(controlPlane)) {
          return yield* Effect.die(
            new Error("MailboxDO ControlPlane binding is unavailable")
          );
        }
        return controlPlane;
      }),
      email: Effect.gen(function* () {
        const environment = yield* Schema.decodeUnknownEffect(
          Schema.Struct({
            MAILBOX_OUTBOUND_PROVIDER_DISABLED: Schema.Union([
              Schema.Boolean,
              Schema.Literals(["true", "false"]),
            ]),
          })
        )(workerEnvironment).pipe(Effect.orDie);
        const providerDisabled =
          environment.MAILBOX_OUTBOUND_PROVIDER_DISABLED === true ||
          environment.MAILBOX_OUTBOUND_PROVIDER_DISABLED === "true";
        if (providerDisabled) {
          return yield* new DeliveryProviderUnavailableError({
            cause: new Error("MailboxEmail binding is disabled"),
            message: "Outbound email provider is unavailable",
          });
        }
        if (!isObject(workerEnvironment)) {
          return yield* Effect.die(
            new Error("MailboxDO Worker environment is unavailable")
          );
        }
        const email: unknown = Reflect.get(workerEnvironment, "MailboxEmail");
        if (!isMailboxEmailBinding(email)) {
          return yield* Effect.die(
            new Error("MailboxDO MailboxEmail binding is unavailable")
          );
        }
        return email;
      }),
      rawMessages: Effect.gen(function* () {
        if (!isObject(workerEnvironment)) {
          return yield* Effect.die(
            new Error("MailboxDO Worker environment is unavailable")
          );
        }
        const rawMessages: unknown = Reflect.get(
          workerEnvironment,
          "RawMessages"
        );
        if (!isRawMessagesBinding(rawMessages)) {
          return yield* Effect.die(
            new Error("MailboxDO RawMessages binding is unavailable")
          );
        }
        return rawMessages;
      }),
    });
  })
);

export const MailboxDoOutboundAttachmentR2ClientLayer = Layer.effect(
  OutboundDraftAttachmentR2ReadClient,
  Effect.gen(function* () {
    const bindings = yield* MailboxDoBindings;

    return OutboundDraftAttachmentR2ReadClient.of({
      get: (key) =>
        bindings.rawMessages.pipe(
          Effect.flatMap((rawMessages) =>
            Effect.tryPromise({
              try: () => rawMessages.get(key),
              catch: (cause) => cause,
            })
          ),
          Effect.map((object) => {
            if (object === null) {
              return null;
            }
            const checksum = object.checksums.sha256;
            return {
              arrayBuffer: () =>
                Effect.tryPromise({
                  try: () => object.arrayBuffer(),
                  catch: (cause) => cause,
                }),
              contentType: object.httpMetadata?.contentType,
              customMetadata: object.customMetadata ?? {},
              sha256:
                checksum === undefined
                  ? undefined
                  : [...new Uint8Array(checksum)]
                      .map((byte) => byte.toString(16).padStart(2, "0"))
                      .join(""),
              size: object.size,
            };
          })
        ),
    });
  })
);

export const MailboxDoEmailSendClientLayer = Layer.effect(
  MailboxEmailSendClient,
  Effect.gen(function* () {
    const bindings = yield* MailboxDoBindings;

    return MailboxEmailSendClient.of({
      send: (message) =>
        bindings.email.pipe(
          Effect.flatMap((email) =>
            Effect.tryPromise({
              try: () => email.send(message),
              catch: (cause) =>
                new Cloudflare.Email.SendEmailError({
                  cause,
                  message:
                    cause instanceof Error
                      ? cause.message
                      : "Unknown send_email error",
                }),
            })
          )
        ),
    });
  })
);
