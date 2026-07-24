import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import { describe, expect, it } from "vitest";

import { cacheSuccessfulInitialization } from "#/apps/backend-worker/SuccessfulInitialization";

describe("successful initialization cache", () => {
  it("retries after failure and caches only success", async () => {
    const attempts = await Effect.runPromise(Ref.make(0));
    const initialize = Ref.updateAndGet(attempts, (value) => value + 1).pipe(
      Effect.flatMap((attempt) =>
        attempt === 1 ? Effect.fail("transient") : Effect.void
      )
    );
    const cached = await Effect.runPromise(
      cacheSuccessfulInitialization(initialize)
    );

    await expect(Effect.runPromise(cached)).rejects.toBe("transient");
    await Effect.runPromise(cached);
    await Effect.runPromise(cached);
    await expect(Effect.runPromise(Ref.get(attempts))).resolves.toBe(2);
  });

  it("serializes concurrent callers into one successful initialization", async () => {
    const attempts = await Effect.runPromise(Ref.make(0));
    const cached = await Effect.runPromise(
      cacheSuccessfulInitialization(
        Ref.update(attempts, (value) => value + 1).pipe(
          Effect.andThen(Effect.sleep("10 millis"))
        )
      )
    );

    await Effect.runPromise(
      Effect.all([cached, cached, cached], { concurrency: "unbounded" })
    );
    await expect(Effect.runPromise(Ref.get(attempts))).resolves.toBe(1);
  });
});
