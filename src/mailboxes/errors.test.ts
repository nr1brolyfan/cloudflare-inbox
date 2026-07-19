import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";
import { describe, expect, it } from "vitest";

import { MailUnavailableError } from "../http/mail-unavailable-error";
import { HttpApiPlatformLive } from "../http/platform";
import {
  DeliveryIndeterminateError,
  DeliveryRejectedError,
  DeliveryTemporaryFailureError,
  MailboxRepositoryError,
} from "./errors";

const UnavailableEndpoint = HttpApiEndpoint.get("get", "/unavailable", {
  error: MailUnavailableError,
  success: Schema.String,
});
class UnavailableGroup extends HttpApiGroup.make("unavailable").add(
  UnavailableEndpoint
) {}
const UnavailableApi = HttpApi.make("UnavailableApi").add(UnavailableGroup);
const UnavailableGroupLive = HttpApiBuilder.group(
  UnavailableApi,
  "unavailable",
  (handlers) =>
    Effect.succeed(
      handlers.handle("get", () =>
        Effect.fail(
          new MailUnavailableError({
            code: "temporarily_unavailable",
            message: "Mail service is temporarily unavailable",
          })
        )
      )
    )
);

describe("mail domain errors", () => {
  it("serializes the public unavailable error without internal causes", async () => {
    const error = Schema.decodeUnknownSync(MailUnavailableError)({
      _tag: "MailUnavailableError",
      code: "temporarily_unavailable",
      message: "Mail service is temporarily unavailable",
      cause: new Error("sensitive provider details"),
    });
    const encoded = Schema.encodeSync(MailUnavailableError)(error);

    expect(encoded).toStrictEqual({
      _tag: "MailUnavailableError",
      code: "temporarily_unavailable",
      message: "Mail service is temporarily unavailable",
    });
    expect(JSON.stringify(encoded)).not.toContain("sensitive");
    expect(
      Exit.isFailure(
        Schema.decodeUnknownExit(MailUnavailableError)({
          _tag: "MailUnavailableError",
          code: "temporarily_unavailable",
          message: "sqlite unavailable at table mailbox_message",
        })
      )
    ).toBeTruthy();

    const { dispose, handler } = HttpRouter.toWebHandler(
      HttpApiBuilder.layer(UnavailableApi).pipe(
        Layer.provide(UnavailableGroupLive),
        Layer.provide(HttpApiPlatformLive),
        Layer.provide(NodeServices.layer)
      ),
      { disableLogger: true }
    );
    try {
      const response = await handler(
        new Request("https://backend.test/unavailable")
      );
      expect(response.status).toBe(503);
    } finally {
      await dispose();
    }
  });

  it("retries repository writes only when non-commit is known", () => {
    const cause = new Error("sqlite unavailable");
    const notCommitted = new MailboxRepositoryError({
      operation: "transaction",
      commitState: "not-committed",
      message: "Mailbox transaction failed",
      cause,
    });
    const committed = new MailboxRepositoryError({
      operation: "transaction",
      commitState: "committed",
      message: "Mailbox response persistence failed",
      cause,
    });
    const unknown = new MailboxRepositoryError({
      operation: "transaction",
      commitState: "unknown",
      message: "Mailbox commit outcome is unknown",
      cause,
    });

    expect([
      notCommitted.retryable,
      committed.retryable,
      unknown.retryable,
    ]).toStrictEqual([true, false, false]);
  });

  it("keeps provider outcomes distinct in the error channel", () => {
    const cause = new Error("provider result");
    const rejected = new DeliveryRejectedError({
      reason: "provider-rejected",
      message: "Provider rejected the message",
      cause,
    });
    const temporary = new DeliveryTemporaryFailureError({
      message: "Provider proved that the message was not accepted",
      cause,
    });
    const indeterminate = new DeliveryIndeterminateError({
      message: "Provider acceptance could not be determined",
      cause,
    });

    expect([rejected._tag, temporary._tag, indeterminate._tag]).toStrictEqual([
      "DeliveryRejectedError",
      "DeliveryTemporaryFailureError",
      "DeliveryIndeterminateError",
    ]);
  });
});
