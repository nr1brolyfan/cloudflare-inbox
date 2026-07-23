import type * as CloudflareWorkers from "@cloudflare/workers-types";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { DeliveryProviderUnavailableError } from "#/modules/mailbox/ports/OutboundEmailProvider";

interface RawMessagesBinding {
  readonly get: (key: string) => Promise<CloudflareWorkers.R2ObjectBody | null>;
}

interface MailboxEmailBinding {
  readonly send: (
    message: CloudflareWorkers.EmailMessageBuilder
  ) => Promise<CloudflareWorkers.EmailSendResult>;
}

export interface MailboxDoOutboundBindings {
  readonly email: Effect.Effect<
    MailboxEmailBinding,
    DeliveryProviderUnavailableError
  >;
  readonly rawMessages: Effect.Effect<RawMessagesBinding>;
}

export const MailboxDoOutboundBindings =
  Context.Service<MailboxDoOutboundBindings>(
    "cloudflare-inbox/MailboxDoOutboundBindings"
  );

const isObject = (value: unknown): value is object =>
  typeof value === "object" && value !== null;

const hasMethod = (value: unknown, name: string): value is object =>
  isObject(value) && typeof Reflect.get(value, name) === "function";

const isRawMessagesBinding = (value: unknown): value is RawMessagesBinding =>
  hasMethod(value, "get");

const isMailboxEmailBinding = (value: unknown): value is MailboxEmailBinding =>
  hasMethod(value, "send");

/** Validates the raw bindings made available to each MailboxDO activation. */
export const MailboxDoOutboundBindingsLive = Layer.effect(
  MailboxDoOutboundBindings,
  Effect.gen(function* () {
    const workerEnvironment: unknown = yield* Cloudflare.WorkerEnvironment;
    return MailboxDoOutboundBindings.of({
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
