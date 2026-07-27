import { Challenge } from "@effect-auth/core/Challenge";
import { Crypto } from "@effect-auth/core/Crypto";
import { Email, IdentityId } from "@effect-auth/core/Identifiers";
import {
  IdentityKindRegistry,
  globalIdentityScope,
} from "@effect-auth/core/Identity";
import {
  MagicLinkStartError,
  defaultMagicLinkSecretBytes,
  defaultMagicLinkTtl,
} from "@effect-auth/core/MagicLink";
import type { MagicLinkStartInput } from "@effect-auth/core/MagicLink";
import { AuthMailer } from "@effect-auth/core/Mailer";
import { and, eq, isNull } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { authUserIdentity } from "#/auth/schema/modules/core";
import { AuthRuntimeConfig } from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";
import { RecoverySafeEmailInitiationDenied } from "#/modules/account-security/adapters/effect-auth/RecoverySafeEmailInitiationEffectAuth";
import { completionUrl } from "#/modules/account-security/domain/CompletionUrl";
import { RecoverySafeIdentityPolicy } from "#/modules/account-security/ports/RecoverySafeIdentityPolicy";
import { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import { EmailAddress } from "#/shared/EmailAddress";

export interface MagicLinkStarterShape {
  readonly start: (
    input: MagicLinkStartInput
  ) => Effect.Effect<{ readonly expiresAt: number }, MagicLinkStartError>;
}

export class MagicLinkStarter extends Context.Service<
  MagicLinkStarter,
  MagicLinkStarterShape
>()("cloudflare-inbox/MagicLinkStarter") {}

const startError = (message: string, cause?: unknown) =>
  new MagicLinkStartError({
    message,
    ...(cause === undefined ? {} : { cause }),
  });

/** Start-only core adapter; verify-only AuthFlow and registration services stay unloaded. */
export const MagicLinkStarterLayer = Layer.effect(
  MagicLinkStarter,
  Effect.gen(function* () {
    const challenge = yield* Challenge;
    const crypto = yield* Crypto;
    const identityKinds = yield* IdentityKindRegistry;
    const authMailer = yield* AuthMailer;
    const policy = yield* RecoverySafeIdentityPolicy;
    const database = yield* ControlPlaneDatabase;
    const config = yield* AuthRuntimeConfig;

    return MagicLinkStarter.of({
      start: Effect.fn("auth.magic_link.start_isolated")(function* (input) {
        yield* Effect.annotateCurrentSpan("auth.method", "magic-link");
        if (
          input.identity.kind !== "email" ||
          input.identity.scope.type !== "global"
        ) {
          return yield* startError(
            "Email authentication requires a global email identity"
          );
        }

        const safeAddress = yield* Schema.decodeUnknownEffect(EmailAddress)(
          input.identity.value
        ).pipe(
          Effect.mapError(() =>
            startError(
              "Email initiation denied",
              new RecoverySafeEmailInitiationDenied()
            )
          )
        );
        yield* policy
          .requireSafeAddress({
            address: safeAddress,
            purpose: "login-email-initiation",
          })
          .pipe(
            Effect.mapError((cause) =>
              startError(
                cause.reason === "storage"
                  ? "Failed to evaluate email initiation policy"
                  : "Email initiation denied",
                cause.reason === "storage"
                  ? cause
                  : new RecoverySafeEmailInitiationDenied()
              )
            )
          );
        const normalized = yield* identityKinds
          .normalize(input.identity)
          .pipe(
            Effect.mapError((cause) =>
              startError("Invalid email identity", cause)
            )
          );
        const [activeIdentity] = yield* database
          .select({ id: authUserIdentity.id })
          .from(authUserIdentity)
          .where(
            and(
              eq(authUserIdentity.scopeType, globalIdentityScope.type),
              eq(authUserIdentity.scopeId, ""),
              eq(authUserIdentity.kind, "email"),
              eq(authUserIdentity.normalizedValue, normalized.normalizedValue),
              isNull(authUserIdentity.revokedAt),
              isNull(authUserIdentity.replacedById)
            )
          )
          .limit(1)
          .pipe(
            Effect.mapError((cause) =>
              startError("Failed to load email identity", cause)
            )
          );
        const identityId =
          activeIdentity === undefined
            ? IdentityId(
                yield* crypto
                  .randomToken(16)
                  .pipe(
                    Effect.mapError((cause) =>
                      startError(
                        "Failed to generate pending identity id",
                        cause
                      )
                    )
                  )
              )
            : IdentityId(activeIdentity.id);
        const secret = yield* crypto
          .randomToken(defaultMagicLinkSecretBytes)
          .pipe(
            Effect.map(Redacted.make),
            Effect.mapError((cause) =>
              startError("Failed to generate magic link secret", cause)
            )
          );
        const issued = yield* challenge
          .issue({
            type: "magic-link",
            subject: identityId,
            ttl: input.ttl ?? defaultMagicLinkTtl,
            secret,
            metadata: {
              emailIdentityId: identityId,
              emailNormalizedValue: normalized.normalizedValue,
              emailIdentityPending: activeIdentity === undefined,
              ...(input.metadata === undefined
                ? {}
                : { authMetadata: input.metadata }),
            },
          })
          .pipe(
            Effect.mapError((cause) =>
              startError("Failed to issue magic link challenge", cause)
            )
          );
        const invalidate = challenge
          .consume(issued.id)
          .pipe(Effect.catchTag("ChallengeConsumeError", () => Effect.void));
        const url = yield* Effect.try({
          try: () =>
            completionUrl(
              config.publicOrigin.origin,
              "/auth-complete/magic-link",
              {
                challengeId: issued.id,
                secret: Redacted.value(secret),
              }
            ),
          catch: (cause) => startError("Failed to build magic link URL", cause),
        }).pipe(
          Effect.catch((error) =>
            invalidate.pipe(Effect.andThen(Effect.fail(error)))
          )
        );

        yield* authMailer
          .send({
            _tag: "MagicLink",
            to: Email(normalized.normalizedValue),
            identityId,
            challengeId: issued.id,
            url,
            expiresAt: issued.expiresAt,
            locale: input.locale,
            metadata: input.metadata,
          })
          .pipe(
            Effect.catch((error) =>
              invalidate.pipe(
                Effect.andThen(
                  Effect.fail(startError("Failed to send magic link", error))
                )
              )
            )
          );

        return { expiresAt: Number(issued.expiresAt) };
      }),
    });
  })
);
