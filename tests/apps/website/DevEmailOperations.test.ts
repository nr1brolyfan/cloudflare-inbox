import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

import type { DevEmailOperationsShape } from "#/apps/website/DevEmailOperations";
import {
  DevEmailOperations,
  DevEmailOperationsLayer,
} from "#/apps/website/DevEmailOperations";
import { BackendClient, WebsiteConfig } from "#/apps/website/WebsitePlatform";

const runDevEmail = <A>(
  enabled: boolean,
  fetch: (request: Request) => Promise<Response>,
  operation: (operations: DevEmailOperationsShape) => Effect.Effect<A>
) =>
  Effect.runPromise(
    DevEmailOperations.pipe(
      Effect.flatMap(operation),
      Effect.provide(
        DevEmailOperationsLayer.pipe(
          Layer.provide(
            Layer.merge(
              Layer.succeed(
                BackendClient,
                BackendClient.of({
                  fetch: (_, request) => Effect.promise(() => fetch(request)),
                })
              ),
              Layer.succeed(
                WebsiteConfig,
                WebsiteConfig.of({ devEmailInboxEnabled: enabled })
              )
            )
          )
        )
      )
    )
  );

describe("Website development email operations", () => {
  it("does not contact the Backend when the inbox is disabled", async () => {
    let requests = 0;
    const incoming = new Request("https://inbox.test/_server");
    const result = await runDevEmail(
      false,
      () => {
        requests += 1;
        return Promise.resolve(new Response());
      },
      (operations) =>
        Effect.all({
          clear: operations.clear(incoming),
          list: operations.list(incoming),
          status: operations.status,
        })
    );

    expect(result).toStrictEqual({
      clear: { enabled: false },
      list: { enabled: false },
      status: { enabled: false },
    });
    expect(requests).toBe(0);
  });

  it("uses the Backend once per enabled inbox operation", async () => {
    const requests: Request[] = [];
    const incoming = new Request("https://inbox.test/_server");
    const message = {
      createdAt: 1000,
      expiresAt: 2000,
      id: "message-a",
      kind: "MagicLink",
      recipient: "person@example.com",
      subject: "Sign in",
      text: "Open the link",
    } as const;
    const result = await runDevEmail(
      true,
      (request) => {
        requests.push(request);
        return Promise.resolve(
          request.method === "GET"
            ? Response.json({ messages: [message] })
            : Response.json({ cleared: true })
        );
      },
      (operations) =>
        Effect.gen(function* () {
          const list = yield* operations.list(incoming);
          const clear = yield* operations.clear(incoming);
          return { clear, list };
        })
    );

    expect(result).toStrictEqual({
      clear: { enabled: true },
      list: { enabled: true, messages: [message] },
    });
    expect(
      requests.map((request) => ({
        method: request.method,
        path: new URL(request.url).pathname,
      }))
    ).toStrictEqual([
      { method: "GET", path: "/api/dev-emails" },
      { method: "DELETE", path: "/api/dev-emails" },
    ]);
  });

  it.each([
    ["list", { messages: [{ id: "missing-required-fields" }] }, /Missing key/u],
    ["clear", { cleared: false }, /Expected true/u],
  ] as const)(
    "rejects malformed %s responses",
    async (operation, body, expectedError) => {
      let requests = 0;
      const incoming = new Request("https://inbox.test/_server");
      const result = runDevEmail(
        true,
        () => {
          requests += 1;
          return Promise.resolve(Response.json(body));
        },
        (operations) => operations[operation](incoming)
      );

      await expect(result).rejects.toThrow(expectedError);
      expect(requests).toBe(1);
    }
  );
});
