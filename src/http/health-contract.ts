import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";

import {
  BackendHealthDegraded,
  BackendHealthOk,
} from "../observability/health";

const HealthDegraded = BackendHealthDegraded.pipe(HttpApiSchema.status(503));

export const HealthEndpoint = HttpApiEndpoint.get("get", "/api/health", {
  success: [BackendHealthOk, HealthDegraded],
});

export class HealthGroup extends HttpApiGroup.make("health").add(
  HealthEndpoint
) {}
