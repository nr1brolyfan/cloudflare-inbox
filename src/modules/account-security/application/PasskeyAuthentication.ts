/* oxlint-disable max-classes-per-file -- Ceremony models, error, and service form one passkey authentication boundary. */
import { passkeyEvidence } from "@effect-auth/core/Assurance";
import { AuthFlow } from "@effect-auth/core/AuthFlow";
import {
  ChallengeIdSchema,
  Email,
  IdentityId,
  UnixMillisSchema,
} from "@effect-auth/core/Identifiers";
import type { LoginRequestContext } from "@effect-auth/core/LoginRisk";
import {
  PasskeyCredentialStore,
  PasskeyOptions,
  PasskeyVerification,
  PasskeyVerifier,
} from "@effect-auth/core/Passkey";
import { PasskeyAuthenticationCredentialPayload } from "@effect-auth/core/PasskeyCredentialPayload";
import * as AuthPermission from "@effect-auth/core/Permission";
import { Sessions } from "@effect-auth/core/Sessions";
import type { IssuedSession } from "@effect-auth/core/Sessions";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  CONTROL_PLANE_STEP_UP_POLICY,
  StepUpVerifiedAt,
} from "#/modules/account-security/domain/StepUpPolicy";
import { PasskeyAuthenticationIdentityStore } from "#/modules/account-security/ports/PasskeyAuthenticationIdentityStore";
import { PasskeyRuntimeConfig } from "#/modules/account-security/ports/PasskeyRuntimeConfig";
import { SensitiveOperationStepUpClock } from "#/modules/account-security/ports/SensitiveOperationStepUpClock";
import { CurrentRequestAuth } from "#/shared/RequestAuth";
import type { CurrentRequestAuthShape } from "#/shared/RequestAuth";

export const StartPasskeySignInCommand = Schema.Struct({});
export const FinishPasskeySignInCommand = Schema.Struct({
  challengeId: ChallengeIdSchema,
  credential: PasskeyAuthenticationCredentialPayload,
});
export const StartPasskeyStepUpCommand = Schema.Struct({});
export const FinishPasskeyStepUpCommand = Schema.Struct({
  challengeId: ChallengeIdSchema,
  credential: PasskeyAuthenticationCredentialPayload,
});

export class StartedPasskeyAuthentication extends Schema.Class<StartedPasskeyAuthentication>(
  "cloudflare-inbox/StartedPasskeyAuthentication"
)({
  challengeId: ChallengeIdSchema,
  expiresAt: UnixMillisSchema,
  publicKey: Schema.Struct({
    allowCredentials: Schema.optional(
      Schema.Array(
        Schema.Struct({
          id: Schema.String,
          transports: Schema.optional(
            Schema.Array(
              Schema.Literals([
                "ble",
                "cable",
                "hybrid",
                "internal",
                "nfc",
                "smart-card",
                "usb",
              ])
            )
          ),
          type: Schema.Literal("public-key"),
        })
      )
    ),
    challenge: Schema.String,
    rpId: Schema.String,
    timeout: Schema.optional(Schema.Number),
    userVerification: Schema.optional(
      Schema.Literals(["required", "preferred", "discouraged"])
    ),
  }),
}) {}

export class PasskeyAuthenticationError extends Data.TaggedError(
  "PasskeyAuthenticationError"
)<{
  readonly cause?: unknown;
  readonly operation:
    | "finish-sign-in"
    | "finish-step-up"
    | "start-sign-in"
    | "start-step-up"
    | "step-up-availability";
  readonly reason:
    | "invalid-credential"
    | "invalid-input"
    | "policy-denied"
    | "restricted-session"
    | "storage";
}> {}

type StepUpEnvironment = AuthPermission.CurrentPrincipal | CurrentRequestAuth;

export interface PasskeyAuthenticationService {
  readonly finishSignIn: (
    command: Schema.Schema.Type<typeof FinishPasskeySignInCommand>,
    request?: LoginRequestContext
  ) => Effect.Effect<IssuedSession, PasskeyAuthenticationError>;
  readonly finishStepUp: (
    command: Schema.Schema.Type<typeof FinishPasskeyStepUpCommand>
  ) => Effect.Effect<
    IssuedSession,
    PasskeyAuthenticationError,
    StepUpEnvironment
  >;
  readonly startSignIn: (
    command: Schema.Schema.Type<typeof StartPasskeySignInCommand>
  ) => Effect.Effect<StartedPasskeyAuthentication, PasskeyAuthenticationError>;
  readonly startStepUp: (
    command: Schema.Schema.Type<typeof StartPasskeyStepUpCommand>
  ) => Effect.Effect<
    StartedPasskeyAuthentication,
    PasskeyAuthenticationError,
    StepUpEnvironment
  >;
  readonly stepUpAvailable: Effect.Effect<
    boolean,
    PasskeyAuthenticationError,
    StepUpEnvironment
  >;
}

const signInChallengeMetadata = {
  ceremonyVersion: 1,
  purpose: "passkey-sign-in",
} as const;

const failure = (
  operation: PasskeyAuthenticationError["operation"],
  reason: PasskeyAuthenticationError["reason"],
  cause?: unknown
) => new PasskeyAuthenticationError({ cause, operation, reason });

const ensureTrusted = (
  requestAuth: CurrentRequestAuthShape,
  principal: AuthPermission.PermissionSubject,
  operation: PasskeyAuthenticationError["operation"]
) => {
  const { validated } = requestAuth;
  return principal.type === "user" &&
    principal.id === validated.actor.userId &&
    validated.actor.userId === validated.currentSession.userId &&
    validated.actor.userId === validated.issued.userId &&
    validated.actor.sessionId === validated.currentSession.sessionId &&
    validated.actor.sessionId === validated.issued.sessionId
    ? Effect.void
    : Effect.fail(failure(operation, "policy-denied"));
};

const requireUnrestricted = (
  requestAuth: CurrentRequestAuthShape,
  operation: PasskeyAuthenticationError["operation"]
) =>
  (requestAuth.validated.currentSession.claims?.requirements?.length ?? 0) === 0
    ? Effect.void
    : Effect.fail(failure(operation, "restricted-session"));

export class PasskeyAuthentication extends Context.Service<
  PasskeyAuthentication,
  PasskeyAuthenticationService
>()("cloudflare-inbox/PasskeyAuthentication", {
  make: Effect.gen(function* () {
    const authFlow = yield* AuthFlow;
    const clock = yield* SensitiveOperationStepUpClock;
    const credentialStore = yield* PasskeyCredentialStore;
    const identities = yield* PasskeyAuthenticationIdentityStore;
    const options = yield* PasskeyOptions;
    const config = yield* PasskeyRuntimeConfig;
    const sessions = yield* Sessions;
    const verification = yield* PasskeyVerification;
    const verifier = yield* PasskeyVerifier;

    const eligible = (
      userId: string,
      operation: PasskeyAuthenticationError["operation"]
    ) =>
      identities.eligible(userId).pipe(
        Effect.mapError((cause) => failure(operation, "storage", cause)),
        Effect.map(Boolean)
      );

    const verifiedIdentity = (userId: string) =>
      identities.verifiedIdentity(userId).pipe(
        Effect.mapError((cause) => failure("finish-sign-in", "storage", cause)),
        Effect.flatMap((identity) =>
          identity === undefined
            ? Effect.fail(failure("finish-sign-in", "invalid-credential"))
            : Effect.succeed(identity)
        )
      );

    const requestContext = (
      operation: PasskeyAuthenticationError["operation"]
    ) =>
      Effect.gen(function* () {
        const requestAuth = yield* CurrentRequestAuth;
        const principal = yield* AuthPermission.CurrentPrincipal;
        yield* ensureTrusted(requestAuth, principal, operation);
        yield* requireUnrestricted(requestAuth, operation);
        return requestAuth;
      });

    const decodeStarted = (
      started: unknown,
      operation: PasskeyAuthenticationError["operation"]
    ) =>
      Schema.decodeUnknownEffect(StartedPasskeyAuthentication)(started).pipe(
        Effect.mapError((cause) => failure(operation, "storage", cause))
      );

    const finish = (
      command: Schema.Schema.Type<typeof FinishPasskeySignInCommand>,
      expectedChallengeMetadata: Readonly<Record<string, unknown>>,
      operation: "finish-sign-in" | "finish-step-up",
      expectedUserId?: string
    ) =>
      Effect.gen(function* () {
        const credentialId = yield* verifier
          .readAuthenticationCredentialId({ response: command.credential })
          .pipe(
            Effect.mapError((cause) =>
              failure(operation, "invalid-credential", cause)
            )
          );
        const stored = yield* credentialStore
          .findByCredentialId(credentialId)
          .pipe(
            Effect.mapError((cause) => failure(operation, "storage", cause))
          );
        if (
          Option.isNone(stored) ||
          stored.value.revokedAt !== undefined ||
          (expectedUserId !== undefined &&
            stored.value.userId !== expectedUserId) ||
          !(yield* eligible(stored.value.userId, operation))
        ) {
          return yield* failure(operation, "invalid-credential");
        }
        const finished = yield* verification
          .finishAuthentication({
            challengeId: command.challengeId,
            expectedChallengeMetadata,
            expectedOrigin: config.expectedOrigins,
            relyingPartyId: config.relyingParty.id,
            requireUserVerification: config.requireUserVerification,
            response: command.credential,
            userId: stored.value.userId,
          })
          .pipe(
            Effect.mapError((cause) =>
              failure(operation, "invalid-credential", cause)
            )
          );
        if (
          finished.userVerification !== "verified" ||
          finished.userId !== stored.value.userId ||
          !(yield* eligible(finished.userId, operation))
        ) {
          return yield* failure(operation, "invalid-credential");
        }
        return finished;
      });

    const evidence = (
      finished: Effect.Success<ReturnType<typeof finish>>,
      operation: "finish-sign-in" | "finish-step-up"
    ) =>
      Schema.decodeUnknownEffect(StepUpVerifiedAt)(clock.now()).pipe(
        Effect.mapError((cause) => failure(operation, "storage", cause)),
        Effect.map((verifiedAt) =>
          passkeyEvidence({
            credentialId: finished.credential.id,
            verifiedAt,
            userVerification: finished.userVerification,
            ...(finished.authenticatorAttachment === undefined
              ? {}
              : {
                  authenticatorAttachment: finished.authenticatorAttachment,
                }),
            ...(finished.backedUp === undefined
              ? {}
              : { backedUp: finished.backedUp }),
            ...(finished.backupEligible === undefined
              ? {}
              : { backupEligible: finished.backupEligible }),
            signCount: finished.signCount,
            ...(finished.aaguid === undefined
              ? {}
              : { aaguid: finished.aaguid }),
          })
        )
      );

    return {
      finishSignIn: (untrusted, request) =>
        Effect.gen(function* () {
          const command = yield* Schema.decodeUnknownEffect(
            FinishPasskeySignInCommand
          )(untrusted).pipe(
            Effect.mapError((cause) =>
              failure("finish-sign-in", "invalid-input", cause)
            )
          );
          const finished = yield* finish(
            command,
            signInChallengeMetadata,
            "finish-sign-in"
          );
          const authenticationEvidence = yield* evidence(
            finished,
            "finish-sign-in"
          );
          const identity = yield* verifiedIdentity(finished.userId);
          // Recovery retires the email login authority; this marker preserves
          // the verified-identity gate only for its replacement UV passkey.
          const verifiedIdentityKinds =
            identity.kind === "recovery-passkey"
              ? (["email", "recovery-passkey"] as const)
              : [identity.kind];
          const result = yield* authFlow
            .completePrimaryFactor({
              claims: { verifiedIdentityKinds },
              evidence: [authenticationEvidence],
              ...(identity.kind === "email"
                ? {
                    emailDestination: {
                      email: Email(identity.value),
                      identityId: IdentityId(identity.id),
                    },
                  }
                : {}),
              identity: {
                identityId: IdentityId(identity.id),
                kind: identity.kind,
                verified: true,
              },
              intent: "sign-in",
              method: "passkey",
              ...(request === undefined ? {} : { request }),
              userId: finished.userId,
            })
            .pipe(
              Effect.mapError((cause) =>
                failure("finish-sign-in", "storage", cause)
              )
            );
          if (result._tag !== "Authenticated") {
            return yield* failure("finish-sign-in", "policy-denied");
          }
          return result.session;
        }),
      finishStepUp: (untrusted) =>
        Effect.gen(function* () {
          const command = yield* Schema.decodeUnknownEffect(
            FinishPasskeyStepUpCommand
          )(untrusted).pipe(
            Effect.mapError((cause) =>
              failure("finish-step-up", "invalid-input", cause)
            )
          );
          const requestAuth = yield* requestContext("finish-step-up");
          const metadata = {
            purpose: "passkey-step-up",
            sessionId: requestAuth.validated.issued.sessionId,
            sessionSecretHash: requestAuth.sessionSecretHash,
            stepUpPolicyId: CONTROL_PLANE_STEP_UP_POLICY.id,
            stepUpPolicyVersion: CONTROL_PLANE_STEP_UP_POLICY.version,
          } as const;
          const finished = yield* finish(
            command,
            metadata,
            "finish-step-up",
            requestAuth.validated.issued.userId
          );
          const authenticationEvidence = yield* evidence(
            finished,
            "finish-step-up"
          );
          return yield* sessions
            .assureAndRotate({
              evidence: authenticationEvidence,
              reason: "step_up",
              token: requestAuth.validated.issued.token,
            })
            .pipe(
              Effect.mapError((cause) =>
                failure("finish-step-up", "storage", cause)
              )
            );
        }),
      startSignIn: (untrusted) =>
        Effect.gen(function* () {
          yield* Schema.decodeUnknownEffect(StartPasskeySignInCommand)(
            untrusted
          ).pipe(
            Effect.mapError((cause) =>
              failure("start-sign-in", "invalid-input", cause)
            )
          );
          const started = yield* options
            .startAuthentication({
              metadata: signInChallengeMetadata,
              relyingPartyId: config.relyingParty.id,
              userVerification: config.userVerification,
            })
            .pipe(
              Effect.mapError((cause) =>
                failure("start-sign-in", "storage", cause)
              )
            );
          return yield* decodeStarted(started, "start-sign-in");
        }),
      startStepUp: (untrusted) =>
        Effect.gen(function* () {
          yield* Schema.decodeUnknownEffect(StartPasskeyStepUpCommand)(
            untrusted
          ).pipe(
            Effect.mapError((cause) =>
              failure("start-step-up", "invalid-input", cause)
            )
          );
          const requestAuth = yield* requestContext("start-step-up");
          if (
            !(yield* eligible(
              requestAuth.validated.issued.userId,
              "start-step-up"
            ))
          ) {
            return yield* failure("start-step-up", "policy-denied");
          }
          const started = yield* options
            .startAuthentication({
              metadata: {
                purpose: "passkey-step-up",
                sessionId: requestAuth.validated.issued.sessionId,
                sessionSecretHash: requestAuth.sessionSecretHash,
                stepUpPolicyId: CONTROL_PLANE_STEP_UP_POLICY.id,
                stepUpPolicyVersion: CONTROL_PLANE_STEP_UP_POLICY.version,
              },
              relyingPartyId: config.relyingParty.id,
              userId: requestAuth.validated.issued.userId,
              userVerification: config.userVerification,
            })
            .pipe(
              Effect.mapError((cause) =>
                failure("start-step-up", "storage", cause)
              )
            );
          return yield* decodeStarted(started, "start-step-up");
        }),
      stepUpAvailable: Effect.gen(function* () {
        const requestAuth = yield* requestContext("step-up-availability");
        if (
          !(yield* eligible(
            requestAuth.validated.issued.userId,
            "step-up-availability"
          ))
        ) {
          return false;
        }
        const credentials = yield* credentialStore
          .listByUser({ userId: requestAuth.validated.issued.userId })
          .pipe(
            Effect.mapError((cause) =>
              failure("step-up-availability", "storage", cause)
            )
          );
        return credentials.some(
          (credential) => credential.revokedAt === undefined
        );
      }),
    } satisfies PasskeyAuthenticationService;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
