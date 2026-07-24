import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

/** Shares concurrent initialization but retains only a successful result. */
export const cacheSuccessfulInitialization = <E, R>(
  initialize: Effect.Effect<void, E, R>
): Effect.Effect<Effect.Effect<void, E, R>> =>
  Effect.gen(function* () {
    const initialized = yield* Ref.make(false);
    const semaphore = yield* Semaphore.make(1);
    return Semaphore.withPermits(
      semaphore,
      1,
      Effect.gen(function* () {
        if (yield* Ref.get(initialized)) {
          return;
        }
        yield* initialize;
        yield* Ref.set(initialized, true);
      })
    );
  });
