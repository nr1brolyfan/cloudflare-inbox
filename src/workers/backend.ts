import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

export default class Backend extends Cloudflare.Worker<Backend>()(
	"Backend",
	{
		main: import.meta.url,
		compatibility: {
			date: "2026-07-11",
			flags: ["nodejs_compat"],
		},
		dev: {
			port: 1338,
			strictPort: true,
		},
	},
	Effect.succeed({
		fetch: Effect.gen(function* () {
			const request = yield* HttpServerRequest;
			const url = new URL(request.url, "http://backend");

			if (request.method === "GET" && url.pathname === "/api/health") {
				return yield* HttpServerResponse.json({
					service: "backend",
					status: "ok",
				});
			}

			return HttpServerResponse.text("Not found", { status: 404 });
		}),
	}),
) {}
