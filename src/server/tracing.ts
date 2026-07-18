import { tracing } from "cloudflare:workers";

export const traceBackendRequest = <A>(
  operation: string,
  request: Request,
  run: () => A
): A =>
  tracing.enterSpan(operation, (span) => {
    if (span.isTraced) {
      const url = new URL(request.url);
      span.setAttribute("http.request.method", request.method);
      span.setAttribute("url.path", url.pathname);
    }

    return run();
  });
