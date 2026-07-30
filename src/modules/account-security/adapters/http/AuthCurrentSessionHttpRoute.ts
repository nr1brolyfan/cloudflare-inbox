import type {
  SessionCookieService,
  SessionsService,
} from "@effect-auth/core/Sessions";
import { SessionCookie, Sessions } from "@effect-auth/core/Sessions";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

const errorResponse = (status: 401 | 500) =>
  HttpServerResponse.jsonUnsafe(
    status === 401
      ? {
          _tag: "AuthUnauthenticatedError",
          code: "unauthenticated",
          message: "Unauthenticated",
        }
      : {
          _tag: "AuthInternalError",
          code: "internal_error",
          message: "Failed to validate session",
        },
    { status }
  );

export const makeAuthCurrentSessionHandler = (dependencies: {
  readonly sessions: SessionsService;
  readonly sessionCookie: SessionCookieService;
}) =>
  Effect.fn("auth.http.session.current_isolated")(function* (
    request: HttpServerRequest.HttpServerRequest
  ) {
    yield* Effect.annotateCurrentSpan("auth.http.endpoint", "session.current");
    const validated = yield* dependencies.sessionCookie
      .read(new Request("http://localhost", { headers: request.headers }))
      .pipe(
        Effect.flatMap((token) =>
          Option.isNone(token)
            ? Effect.succeed(Option.none())
            : dependencies.sessions
                .validate(token.value)
                .pipe(Effect.map(Option.some))
        ),
        Effect.match({
          onFailure: (error) =>
            ({
              _tag: "failure" as const,
              internal:
                typeof error === "object" &&
                error !== null &&
                "cause" in error &&
                error.cause !== undefined,
            }) as const,
          onSuccess: (session) => ({ _tag: "success" as const, session }),
        })
      );

    if (validated._tag === "failure") {
      return errorResponse(validated.internal ? 500 : 401);
    }
    if (Option.isNone(validated.session)) {
      return errorResponse(401);
    }

    const session = validated.session.value.currentSession;
    const claims =
      session.claims === undefined
        ? undefined
        : {
            ...(session.claims.verifiedIdentityKinds === undefined
              ? {}
              : {
                  verifiedIdentityKinds: session.claims.verifiedIdentityKinds,
                }),
            ...(session.claims.requirements === undefined
              ? {}
              : { requirements: session.claims.requirements }),
            ...(session.claims.recoveryEnrollment === undefined
              ? {}
              : { recoveryEnrollment: session.claims.recoveryEnrollment }),
          };

    yield* Effect.annotateCurrentSpan({
      "auth.http.result": "authenticated",
      "http.response.status_code": 200,
    });
    return HttpServerResponse.jsonUnsafe({
      type: "authenticated",
      userId: session.userId,
      sessionId: session.sessionId,
      authTime: Number(session.authTime),
      expiresAt: Number(session.expiresAt),
      aal: session.aal,
      amr: session.amr,
      ...(session.mfaVerifiedAt === undefined
        ? {}
        : { mfaVerifiedAt: session.mfaVerifiedAt }),
      ...(claims === undefined ? {} : { claims }),
    });
  });

const registerRoutes = HttpRouter.use;

/** Exact current-session route, independent from the aggregate auth HTTP API. */
export const AuthCurrentSessionHttpRouteLayer = registerRoutes((router) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions;
    const sessionCookie = yield* SessionCookie;
    yield* router.add(
      "GET",
      "/auth/session",
      makeAuthCurrentSessionHandler({ sessions, sessionCookie })
    );
  })
);
