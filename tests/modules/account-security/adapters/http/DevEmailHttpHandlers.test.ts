import { DevEmailStore } from "@effect-auth/core/DevEmail";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi";
import { describe, expect, it } from "vitest";

import { HttpApiPlatformLive } from "#/http/platform";
import { DevEmailGroup } from "#/modules/account-security/adapters/http/DevEmailHttpApi";
import {
  DevEmailConfig,
  DevEmailHttpHandlersLayer,
} from "#/modules/account-security/adapters/http/DevEmailHttpHandlers";

const DevEmailTestApi = HttpApi.make("AuthApi").add(DevEmailGroup);

describe("development email API", () => {
  it("fails closed before reading the store outside development", async () => {
    let lists = 0;
    const store = DevEmailStore.of({
      clear: () => Effect.void,
      list: () => {
        lists += 1;
        return Effect.succeed([]);
      },
      save: () => Effect.void,
    });
    const groupLive = DevEmailHttpHandlersLayer.pipe(
      Layer.provide(Layer.succeed(DevEmailStore, store)),
      Layer.provide(
        Layer.succeed(
          DevEmailConfig,
          DevEmailConfig.of({ isDevelopment: false })
        )
      )
    );
    const { dispose, handler } = HttpRouter.toWebHandler(
      HttpApiBuilder.layer(DevEmailTestApi).pipe(
        Layer.provide(groupLive),
        Layer.provide(HttpApiPlatformLive),
        Layer.provide(NodeServices.layer)
      ),
      { disableLogger: true }
    );

    try {
      const response = await handler(
        new Request("https://backend.test/api/dev-emails")
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        code: "not_found",
      });
      expect(lists).toBe(0);
    } finally {
      await dispose();
    }
  });
});
