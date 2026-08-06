export type BackendHttpApplicationKind =
  | "aggregate"
  | "health"
  | "magic-link-start"
  | "session";

export const backendHttpApplicationKind = (
  method: string,
  pathname: string
): BackendHttpApplicationKind => {
  if (method === "GET" && pathname === "/api/health") {
    return "health";
  }
  if (method === "GET" && pathname === "/auth/session") {
    return "session";
  }
  return method === "POST" && pathname === "/auth/magic-link/start"
    ? "magic-link-start"
    : "aggregate";
};
