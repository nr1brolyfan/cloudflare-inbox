import { DatabaseSync } from "node:sqlite";

import type { D1Database } from "@cloudflare/workers-types";
import {
  emptyCustomEvidencePolicyRegistry,
  passkeyEvidence,
} from "@effect-auth/core/Assurance";
import { AuthFlow, AuthResult } from "@effect-auth/core/AuthFlow";
import {
  ChallengeId,
  CredentialId,
  SessionId,
  SessionToken,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import {
  PasskeyCredentialStore,
  PasskeyCredentialId,
  PasskeyOptions,
  PasskeyVerification,
  PasskeyVerifier,
} from "@effect-auth/core/Passkey";
import * as AuthPermission from "@effect-auth/core/Permission";
import { Sessions } from "@effect-auth/core/Sessions";
import type {
  IssuedSession,
  ValidatedSession,
} from "@effect-auth/core/Sessions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  FinishPasskeySignInCommand,
  FinishPasskeyStepUpCommand,
  PasskeyAuthentication,
  PasskeyAuthenticationError,
} from "#/auth/passkey-authentication";
import {
  PasskeyRuntimeConfig,
  PasskeyRuntimeConfigSchema,
} from "#/auth/passkey-config";
import type { CurrentRequestAuthShape } from "#/auth/session";
import { CurrentRequestAuth } from "#/auth/session";
import { SensitiveOperationStepUpClock } from "#/auth/step-up-policy";
import {
  ControlPlaneD1Binding,
  ControlPlaneDatabaseLive,
} from "#/control-plane/database";

import { applyControlPlaneMigrations, makeTestD1Database } from "../support/d1";

const now = Date.now();
const challengeId = ChallengeId("passkey-authentication-challenge-a");
const userId = UserId("user-a");
const sessionId = SessionId("session-a");
const credentialRecordId = CredentialId("passkey-record-a");
const webauthnCredentialId = PasskeyCredentialId("webauthn-credential-a");
const clientCredential = {
  id: "browser-credential-a",
  response: { authenticatorData: "signed-authenticator-data" },
  type: "public-key" as const,
};
const config = Schema.decodeUnknownSync(PasskeyRuntimeConfigSchema)({
  attestation: "none",
  authenticatorSelection: {
    requireResidentKey: true,
    residentKey: "required",
    userVerification: "required",
  },
  expectedOrigin: "https://inbox.example.test",
  relyingParty: { id: "inbox.example.test", name: "Cloudflare Inbox" },
  requireUserVerification: true,
  userVerification: "required",
});
const issuedSession = {
  aal: "aal2" as const,
  amr: ["passkey"],
  authenticationEvents: [
    passkeyEvidence({
      credentialId: credentialRecordId,
      signCount: 8,
      userVerification: "verified",
      verifiedAt: UnixMillis(now),
    }),
  ],
  authTime: UnixMillis(now),
  expiresAt: UnixMillis(now + 60 * 60 * 1000),
  sessionId,
  token: SessionToken("session-a.new-secret"),
  userId,
} satisfies IssuedSession;
const validatedSession = {
  actor: { sessionId, userId },
  currentSession: {
    aal: "aal1" as const,
    amr: ["pwd"],
    authenticationEvents: [],
    authTime: UnixMillis(now - 1000),
    expiresAt: UnixMillis(now + 60 * 60 * 1000),
    sessionId,
    userId,
  },
  issued: {
    aal: "aal1" as const,
    amr: ["pwd"],
    authenticationEvents: [],
    authTime: UnixMillis(now - 1000),
    expiresAt: UnixMillis(now + 60 * 60 * 1000),
    sessionId,
    token: SessionToken("session-a.old-secret"),
    userId,
  },
} satisfies ValidatedSession;
const credential = {
  backedUp: true,
  createdAt: UnixMillis(now - 10_000),
  credentialId: webauthnCredentialId,
  id: credentialRecordId,
  publicKey: "sensitive-public-key",
  signCount: 7,
  userId,
};

interface TestState {
  authenticationStarts: unknown[];
  expectedChallengeMetadata: unknown[];
  primaryFactorInputs: unknown[];
  rotations: unknown[];
}

const insertVerifiedRecovery = (database: DatabaseSync) => {
  const expiresAt = now + 60 * 60 * 1000;
  database
    .prepare(
      "insert into auth_user (id, created_at, updated_at) values (?, ?, ?)"
    )
    .run(userId, now - 20_000, now - 20_000);
  database
    .prepare(
      `insert into auth_user_identity
        (id, user_id, scope_type, scope_id, kind, value, normalized_value,
         verified_at, is_primary_login, created_at, updated_at)
       values ('login-a', ?, 'global', 'global', 'email', 'user@example.test',
               'user@example.test', ?, 1, ?, ?)`
    )
    .run(userId, now - 20_000, now - 20_000, now - 20_000);
  database
    .prepare(
      `insert into auth_verification
        (id, type, subject, secret_hash, created_at, expires_at, metadata)
       values ('recovery-challenge-a',
               'external-recovery-identity-verification', 'recovery-a',
               'hash', ?, ?, '{"userId":"user-a"}')`
    )
    .run(now - 10_000, expiresAt);
  database
    .prepare(
      `insert into app_external_recovery_identity
        (id, user_id, address, normalized_address, comparison_key, status,
         challenge_id, challenge_expires_at, enrollment_operation_id,
         created_at, updated_at, version)
       values ('recovery-a', 'user-a', 'recovery@external.test',
               'recovery@external.test', 'recovery@external.test', 'pending',
               'recovery-challenge-a', ?,
               '00000000-0000-4000-8000-000000000020', ?, ?, 1)`
    )
    .run(expiresAt, now - 10_000, now - 10_000);
  database
    .prepare(
      "update auth_verification set consumed_at = ? where id = 'recovery-challenge-a'"
    )
    .run(now - 5000);
  database
    .prepare(
      `update app_external_recovery_identity
          set status = 'verified', verified_at = ?, updated_at = ?, version = 2
        where id = 'recovery-a'`
    )
    .run(now - 5000, now - 5000);
};

const serviceLayer = (
  database: DatabaseSync,
  state: TestState,
  options: { readonly verificationFailure?: boolean } = {}
) => {
  const d1 = makeTestD1Database(database);
  const databaseLayer = ControlPlaneDatabaseLive.pipe(
    Layer.provide(
      Layer.succeed(
        ControlPlaneD1Binding,
        ControlPlaneD1Binding.of({ database: d1 as unknown as D1Database })
      )
    )
  );

  return PasskeyAuthentication.layerNoDeps.pipe(
    Layer.provide([
      databaseLayer,
      Layer.succeed(PasskeyRuntimeConfig, config),
      Layer.succeed(
        SensitiveOperationStepUpClock,
        SensitiveOperationStepUpClock.of({ now: () => now })
      ),
      Layer.mock(PasskeyOptions, {
        startAuthentication: (input) =>
          Effect.sync(() => {
            state.authenticationStarts.push(input);
            return {
              challengeId,
              expiresAt: UnixMillis(now + 300_000),
              publicKey: {
                challenge: "server-challenge",
                rpId: input.relyingPartyId,
                userVerification: input.userVerification,
                ...(input.userId === undefined
                  ? {}
                  : {
                      allowCredentials: [
                        {
                          id: webauthnCredentialId,
                          type: "public-key" as const,
                        },
                      ],
                    }),
              },
            };
          }),
      }),
      Layer.mock(PasskeyVerifier, {
        readAuthenticationCredentialId: () =>
          Effect.succeed(webauthnCredentialId),
      }),
      Layer.mock(PasskeyCredentialStore, {
        findByCredentialId: () => Effect.succeed(Option.some(credential)),
        listByUser: () => Effect.succeed([credential]),
      }),
      Layer.mock(PasskeyVerification, {
        finishAuthentication: (input) =>
          Effect.sync(() => {
            state.expectedChallengeMetadata.push(
              input.expectedChallengeMetadata
            );
            if (options.verificationFailure === true) {
              throw new Error("challenge metadata mismatch");
            }
            return {
              backedUp: true,
              challengeId: input.challengeId,
              credential: { ...credential, signCount: 8 },
              signCount: 8,
              userId,
              userVerification: "verified" as const,
            };
          }),
      }),
      Layer.mock(AuthFlow, {
        completePrimaryFactor: (input) =>
          Effect.sync(() => {
            state.primaryFactorInputs.push(input);
            return AuthResult.Authenticated({ session: issuedSession });
          }),
      }),
      Layer.mock(Sessions, {
        assureAndRotate: (input) =>
          Effect.sync(() => {
            state.rotations.push(input);
            return issuedSession;
          }),
        customEvidencePolicies: emptyCustomEvidencePolicyRegistry,
      }),
    ])
  );
};

const runStepUp = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    AuthPermission.CurrentPrincipal | CurrentRequestAuthShape | R
  >,
  layer: Layer.Layer<PasskeyAuthentication>
) =>
  effect.pipe(
    Effect.provide(layer),
    Effect.provideService(
      CurrentRequestAuth,
      CurrentRequestAuth.of({
        sessionSecretHash: "old-secret-hash",
        validated: validatedSession,
      })
    ),
    Effect.provideService(
      AuthPermission.CurrentPrincipal,
      AuthPermission.CurrentPrincipal.of(
        AuthPermission.PermissionSubject.user(userId)
      )
    )
  );

const makeState = (): TestState => ({
  authenticationStarts: [],
  expectedChallengeMetadata: [],
  primaryFactorInputs: [],
  rotations: [],
});

describe("passkey authentication", () => {
  it("starts discoverable sign-in without a caller-selected user or credential list", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertVerifiedRecovery(database);
      const state = makeState();
      const layer = serviceLayer(database, state);

      const started = await Effect.runPromise(
        Effect.gen(function* () {
          const authentication = yield* PasskeyAuthentication;
          return yield* authentication.startSignIn({});
        }).pipe(Effect.provide(layer))
      );

      expect(started.publicKey).toMatchObject({
        rpId: "inbox.example.test",
        userVerification: "required",
      });
      expect(started.publicKey.allowCredentials).toBeUndefined();
      expect(state.authenticationStarts).toMatchObject([
        {
          metadata: { ceremonyVersion: 1, purpose: "passkey-sign-in" },
          relyingPartyId: "inbox.example.test",
          userVerification: "required",
        },
      ]);
      expect(state.authenticationStarts[0]).not.toHaveProperty("userId");
    } finally {
      database.close();
    }
  });

  it("finishes sign-in through the passkey auth-flow pipeline", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertVerifiedRecovery(database);
      const state = makeState();
      const layer = serviceLayer(database, state);
      const command = Schema.decodeUnknownSync(FinishPasskeySignInCommand)({
        challengeId,
        credential: clientCredential,
      });

      const session = await Effect.runPromise(
        Effect.gen(function* () {
          const authentication = yield* PasskeyAuthentication;
          return yield* authentication.finishSignIn(command, {
            ip: "203.0.113.10",
            userAgent: "passkey-test-agent",
          });
        }).pipe(Effect.provide(layer))
      );

      expect(session).toBe(issuedSession);
      expect(state.expectedChallengeMetadata).toStrictEqual([
        { ceremonyVersion: 1, purpose: "passkey-sign-in" },
      ]);
      expect(state.primaryFactorInputs).toMatchObject([
        {
          claims: { verifiedIdentityKinds: ["email"] },
          emailDestination: {
            email: "user@example.test",
            identityId: "login-a",
          },
          identity: {
            identityId: "login-a",
            kind: "email",
            verified: true,
          },
          intent: "sign-in",
          method: "passkey",
          request: {
            ip: "203.0.113.10",
            userAgent: "passkey-test-agent",
          },
          userId,
        },
      ]);
    } finally {
      database.close();
    }
  });

  it("keeps a recovered passkey identity unrestricted on later sign-in", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertVerifiedRecovery(database);
      database
        .prepare(
          `update auth_user_identity
              set kind = 'recovery-passkey', value = user_id,
                  normalized_value = user_id, updated_at = ?
            where id = 'login-a'`
        )
        .run(now);
      const state = makeState();
      const command = Schema.decodeUnknownSync(FinishPasskeySignInCommand)({
        challengeId,
        credential: clientCredential,
      });

      await Effect.runPromise(
        Effect.gen(function* () {
          const authentication = yield* PasskeyAuthentication;
          return yield* authentication.finishSignIn(command);
        }).pipe(Effect.provide(serviceLayer(database, state)))
      );

      expect(state.primaryFactorInputs).toMatchObject([
        {
          claims: {
            verifiedIdentityKinds: ["email", "recovery-passkey"],
          },
          identity: {
            identityId: "login-a",
            kind: "recovery-passkey",
            verified: true,
          },
          method: "passkey",
        },
      ]);
      expect(state.primaryFactorInputs[0]).not.toHaveProperty(
        "emailDestination"
      );
    } finally {
      database.close();
    }
  });

  it("denies sign-in before verification when the account is disabled", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertVerifiedRecovery(database);
      database
        .prepare("update auth_user set disabled_at = ? where id = 'user-a'")
        .run(now);
      const state = makeState();
      const layer = serviceLayer(database, state);
      const command = Schema.decodeUnknownSync(FinishPasskeySignInCommand)({
        challengeId,
        credential: clientCredential,
      });

      const error = await Effect.runPromise(
        Effect.gen(function* () {
          const authentication = yield* PasskeyAuthentication;
          return yield* authentication.finishSignIn(command);
        }).pipe(Effect.provide(layer), Effect.flip)
      );

      expect(error).toBeInstanceOf(PasskeyAuthenticationError);
      expect(error).toMatchObject({
        operation: "finish-sign-in",
        reason: "invalid-credential",
      });
      expect(state.expectedChallengeMetadata).toStrictEqual([]);
    } finally {
      database.close();
    }
  });

  it("binds passkey step-up to the session token generation and policy", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertVerifiedRecovery(database);
      const state = makeState();
      const layer = serviceLayer(database, state);

      const started = await Effect.runPromise(
        runStepUp(
          Effect.gen(function* () {
            const authentication = yield* PasskeyAuthentication;
            return yield* authentication.startStepUp({});
          }),
          layer
        )
      );
      const command = Schema.decodeUnknownSync(FinishPasskeyStepUpCommand)({
        challengeId: started.challengeId,
        credential: clientCredential,
      });
      const session = await Effect.runPromise(
        runStepUp(
          Effect.gen(function* () {
            const authentication = yield* PasskeyAuthentication;
            return yield* authentication.finishStepUp(command);
          }),
          layer
        )
      );

      const expectedMetadata = {
        purpose: "passkey-step-up",
        sessionId,
        sessionSecretHash: "old-secret-hash",
        stepUpPolicyId: "control-plane-sensitive",
        stepUpPolicyVersion: 1,
      };
      expect(started.publicKey.allowCredentials).toHaveLength(1);
      expect(state.authenticationStarts).toMatchObject([
        { metadata: expectedMetadata, userId },
      ]);
      expect(state.expectedChallengeMetadata).toStrictEqual([expectedMetadata]);
      expect(session).toBe(issuedSession);
      expect(state.rotations).toMatchObject([
        {
          evidence: {
            credentialId: credentialRecordId,
            type: "passkey",
            userVerification: "verified",
          },
          reason: "step_up",
          token: validatedSession.issued.token,
        },
      ]);
    } finally {
      database.close();
    }
  });
});
