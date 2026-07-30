export type BackendHttpFeature =
  | "accountSecurity"
  | "health"
  | "magicLinkStart"
  | "magicLinkVerify"
  | "mailbox"
  | "organization"
  | "session"
  | "stepUpOptions";

/** Exhaustive runtime boundary; unknown routes never load an aggregate graph. */
export const backendHttpFeatureFor = (
  method: string,
  pathname: string
): BackendHttpFeature | undefined => {
  const route = `${method} ${pathname}`;
  if (route === "GET /auth/session") {
    return "session";
  }
  if (route === "POST /auth/magic-link/start") {
    return "magicLinkStart";
  }
  if (route === "POST /auth/magic-link/verify") {
    return "magicLinkVerify";
  }
  if (route === "GET /auth/step-up/options") {
    return "stepUpOptions";
  }
  if (pathname.startsWith("/auth/") || pathname.startsWith("/api/dev-emails")) {
    return "accountSecurity";
  }
  if (route === "GET /api/health") {
    return "health";
  }
  if (pathname.startsWith("/api/mailboxes/")) {
    return "mailbox";
  }
  if (pathname.startsWith("/api/organizations/")) {
    return "organization";
  }
  return undefined;
};
