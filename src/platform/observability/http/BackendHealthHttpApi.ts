import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";

import { BackendHealthDegraded, BackendHealthOk } from "../BackendHealth";

const BackendHealthDegradedResponse = BackendHealthDegraded.pipe(
  HttpApiSchema.status(503)
);

export const BackendHealthEndpoint = HttpApiEndpoint.get("get", "/api/health", {
  success: [BackendHealthOk, BackendHealthDegradedResponse],
});

export class BackendHealthGroup extends HttpApiGroup.make("health").add(
  BackendHealthEndpoint
) {}

export const BackendHealthHttpApi =
  HttpApi.make("AuthApi").add(BackendHealthGroup);
