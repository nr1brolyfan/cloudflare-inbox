import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import { describe, expect, it } from "vitest";

import { BackendHttpApi } from "#/apps/backend-worker/BackendHttpApi";
import {
  backendFeatureFor,
  BackendSpecializedEndpoints,
} from "#/apps/backend-worker/BackendHttpDispatch";

const reflectedEndpoints = () => {
  const endpoints: {
    readonly endpoint: string;
    readonly group: string;
    readonly method: string;
    readonly path: string;
  }[] = [];
  HttpApi.reflect(BackendHttpApi, {
    onEndpoint: ({ endpoint, group }) => {
      endpoints.push({
        endpoint: endpoint.identifier,
        group: group.identifier,
        method: endpoint.method,
        path: endpoint.path,
      });
    },
    onGroup: () => void 0,
  });
  return endpoints;
};

describe("Backend HTTP dispatch", () => {
  it("keeps every specialized endpoint aligned with the complete API", () => {
    const reflected = reflectedEndpoints();

    for (const [, endpoint] of BackendSpecializedEndpoints) {
      expect(reflected).toContainEqual(endpoint);
    }
  });

  it("assigns every specialized method and path exactly once", () => {
    const keys = BackendSpecializedEndpoints.map(
      ([, endpoint]) => `${endpoint.method} ${endpoint.path}`
    );

    expect(new Set(keys).size).toBe(keys.length);
    for (const [feature, endpoint] of BackendSpecializedEndpoints) {
      expect(backendFeatureFor(endpoint.method, endpoint.path)).toBe(feature);
    }
  });

  it("keeps all other API routes on the complete graph", () => {
    const specialized = new Set(
      BackendSpecializedEndpoints.map(
        ([, endpoint]) => `${endpoint.method} ${endpoint.path}`
      )
    );

    const features = reflectedEndpoints()
      .filter(
        (endpoint) => !specialized.has(`${endpoint.method} ${endpoint.path}`)
      )
      .map((endpoint) => backendFeatureFor(endpoint.method, endpoint.path));

    expect(features).toStrictEqual(features.map(() => "complete"));
  });
});
