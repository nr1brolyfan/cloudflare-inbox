import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Etag from "effect/unstable/http/Etag";
import * as HttpPlatform from "effect/unstable/http/HttpPlatform";

const HttpPlatformStub = Layer.succeed(HttpPlatform.HttpPlatform, {
  fileResponse: () => Effect.die("HttpPlatform.fileResponse is not supported"),
  fileWebResponse: () =>
    Effect.die("HttpPlatform.fileWebResponse is not supported"),
});

/** Minimal HttpApi platform support; Backend routes never serve files. */
export const HttpApiPlatformLayer = Layer.mergeAll(
  Etag.layer,
  Path.layer,
  HttpPlatformStub
);
