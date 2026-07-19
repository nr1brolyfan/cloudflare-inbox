import type * as CloudflareWorkers from "@cloudflare/workers-types";
import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

type EmailRoutingHandler<Req = never> = (
  message: CloudflareWorkers.ForwardableEmailMessage
) => Effect.Effect<void, never, Req>;

export interface EmailRoutingEventSource {
  readonly listen: <Req = never>(
    handler: EmailRoutingHandler<Req>
  ) => Effect.Effect<void, never, Exclude<Req, RuntimeContext>>;
}

export const EmailRoutingEventSource = Context.Service<EmailRoutingEventSource>(
  "cloudflare-inbox/EmailRoutingEventSource"
);

interface WorkerEventRuntimeContext {
  readonly listen: <A, Req = never>(
    handler: (
      event: Cloudflare.WorkerEvent
    ) => Effect.Effect<A, never, Req> | undefined
  ) => Effect.Effect<void, never, Req>;
}

const requireWorkerEventRuntimeContext = RuntimeContext.pipe(
  Effect.flatMap((context) => {
    const candidate = context as unknown as { readonly listen?: unknown };

    return typeof candidate.listen === "function"
      ? Effect.succeed(context as unknown as WorkerEventRuntimeContext)
      : Effect.die(
          new Error("Worker runtime context does not support event listeners")
        );
  })
);

const listen = <Req = never>(handler: EmailRoutingHandler<Req>) =>
  Effect.gen(function* () {
    const context = yield* requireWorkerEventRuntimeContext;

    yield* context.listen((event) => {
      if (!Cloudflare.isWorkerEvent(event) || event.type !== "email") {
        return;
      }

      return handler(event.input);
    });
  }) as Effect.Effect<void, never, Exclude<Req, RuntimeContext>>;

export const EmailRoutingEventSourceLive = Layer.succeed(
  EmailRoutingEventSource,
  EmailRoutingEventSource.of({ listen })
);
