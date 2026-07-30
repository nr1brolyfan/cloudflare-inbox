import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";

const requestEvidenceOrigin = (value: string, fromReferer: boolean) => {
  if (value.length === 0 || value.length > 2048 || value !== value.trim()) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      (!fromReferer && url.origin !== value) ||
      (!fromReferer &&
        (url.pathname !== "/" || url.search !== "" || url.hash !== ""))
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
};

/** Mirrors effect-auth's strict Origin/Referer evidence validation. */
export const authRequestOriginAllowed = (
  request: HttpServerRequest.HttpServerRequest,
  allowedOrigin: string
) => {
  const { origin, referer } = request.headers;
  if (origin === undefined && referer === undefined) {
    return false;
  }
  const requestOrigin =
    origin === undefined
      ? requestEvidenceOrigin(referer as string, true)
      : requestEvidenceOrigin(origin, false);
  return requestOrigin === allowedOrigin;
};
