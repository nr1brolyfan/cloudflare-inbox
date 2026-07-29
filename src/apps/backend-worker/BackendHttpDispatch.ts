import type * as HttpApi from "effect/unstable/httpapi/HttpApi";
import type * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import type * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";

import type { BackendHttpApi } from "./BackendHttpApi";

type BackendGroups =
  typeof BackendHttpApi extends HttpApi.HttpApi<string, infer Groups>
    ? Groups
    : never;

type BackendEndpointDescriptor = BackendGroups extends infer Group
  ? Group extends HttpApiGroup.Constraint
    ? HttpApiGroup.Endpoints<Group> extends infer Endpoint
      ? Endpoint extends HttpApiEndpoint.Constraint & {
          readonly method: infer Method;
          readonly path: infer Path;
        }
        ? {
            readonly endpoint: Endpoint["identifier"];
            readonly group: Group["identifier"];
            readonly method: Method;
            readonly path: Path;
          }
        : never
      : never
    : never
  : never;

export type BackendFeature =
  | "authSession"
  | "complete"
  | "health"
  | "magicLinkStart"
  | "magicLinkVerify"
  | "stepUpOptions";

type SpecializedBackendFeature = Exclude<BackendFeature, "complete">;

export const BackendSpecializedEndpoints = [
  [
    "health",
    { endpoint: "get", group: "health", method: "GET", path: "/api/health" },
  ],
  [
    "authSession",
    {
      endpoint: "current",
      group: "session",
      method: "GET",
      path: "/auth/session",
    },
  ],
  [
    "magicLinkStart",
    {
      endpoint: "start",
      group: "magicLink",
      method: "POST",
      path: "/auth/magic-link/start",
    },
  ],
  [
    "magicLinkVerify",
    {
      endpoint: "verify",
      group: "magicLink",
      method: "POST",
      path: "/auth/magic-link/verify",
    },
  ],
  [
    "stepUpOptions",
    {
      endpoint: "options",
      group: "stepUp",
      method: "GET",
      path: "/auth/step-up/options",
    },
  ],
] as const satisfies readonly (readonly [
  SpecializedBackendFeature,
  BackendEndpointDescriptor,
])[];

export const backendFeatureFor = (
  method: string,
  pathname: string
): BackendFeature =>
  BackendSpecializedEndpoints.find(
    ([, endpoint]) => endpoint.method === method && endpoint.path === pathname
  )?.[0] ?? "complete";
