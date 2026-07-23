import {
  AuthOriginCheckMiddlewareLive,
  AuthSchemaErrorMiddlewareLive,
  CoreAuthHttpApi,
  EmailOtpHttpOperations,
} from "@effect-auth/core/HttpApi";
import { ChallengeId, UnixMillis } from "@effect-auth/core/Identifiers";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpApiTest } from "effect/unstable/httpapi";
import { describe, expect, it } from "vitest";

import { HttpApiPlatformLive } from "#/http/platform";
import { RestrictedEmailOtpHttpHandlersLayer } from "#/modules/account-security/adapters/http/AccountSecurityAuthHttpHandlers";

const identity = {
  kind: "email",
  scope: { type: "global" as const },
  value: "person@example.com",
};
const EmailOtpClient = HttpApiTest.groups(CoreAuthHttpApi, ["emailOtp"]);

const runEmailOtpClient = <A, E>(
  use: (client: Effect.Success<typeof EmailOtpClient>) => Effect.Effect<A, E>,
  onStart?: () => void
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* EmailOtpClient;
        return yield* use(client);
      }).pipe(
        Effect.provide(RestrictedEmailOtpHttpHandlersLayer),
        Effect.provide(
          Layer.succeed(
            EmailOtpHttpOperations,
            EmailOtpHttpOperations.of({
              start: ({ payload }) =>
                Effect.sync(() => {
                  onStart?.();
                  return {
                    challengeId: ChallengeId("challenge-a"),
                    expiresAt: UnixMillis(1000),
                    identity: payload.identity,
                  };
                }),
              verify: () => Effect.die("verify is not used by this test"),
            })
          )
        ),
        Effect.provide(
          AuthOriginCheckMiddlewareLive({ allowMissingOrigin: true })
        ),
        Effect.provide(AuthSchemaErrorMiddlewareLive),
        Effect.provide(HttpApiPlatformLive),
        Effect.provide(NodeServices.layer)
      )
    )
  );

describe("restricted email OTP API", () => {
  it("delegates valid start requests to the effect-auth operation", async () => {
    const result = await runEmailOtpClient((client) =>
      client.emailOtp.start({ payload: { identity } })
    );

    expect(result).toStrictEqual({
      challengeId: "challenge-a",
      expiresAt: 1000,
      identity,
    });
  });

  it("rejects caller-provided secrets before the operation", async () => {
    let starts = 0;
    const error = await runEmailOtpClient(
      (client) =>
        client.emailOtp
          .start({ payload: { identity, secret: "attacker-secret" } })
          .pipe(Effect.flip),
      () => {
        starts += 1;
      }
    );

    expect(error).toMatchObject({
      _tag: "AuthBadRequestError",
      code: "bad_request",
      message: "Invalid email OTP request",
    });
    expect(starts).toBe(0);
  });
});
