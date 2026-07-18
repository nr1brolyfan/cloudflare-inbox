import { RateLimitDurableObject } from "@effect-auth/core/AlchemyCloudflareRateLimitDurableObject";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { ControlPlaneDatabase, RawMessagesBucket } from "../infra/resources";

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
	Effect.gen(function* () {
		const controlPlane =
			yield* Cloudflare.D1.QueryDatabase(ControlPlaneDatabase);
		const rawMessages = yield* Cloudflare.R2.ReadWriteBucket(RawMessagesBucket);
		const authRateLimit = yield* RateLimitDurableObject;

		return {
			fetch: Effect.gen(function* () {
				const request = yield* HttpServerRequest;
				const url = new URL(request.url, "http://backend");

				if (request.method === "GET" && url.pathname === "/api/health") {
					const checks = yield* Effect.all(
						{
							authRateLimit: authRateLimit
								.getByName("health")
								.fixedWindow({
									limit: undefined,
									refillMillis: 1,
									tokens: 0,
								})
								.pipe(Effect.exit),
							controlPlane: controlPlane
								.prepare("select 1 as ready")
								.first()
								.pipe(Effect.exit),
							rawMessages: rawMessages.head("__health__").pipe(Effect.exit),
						},
						{ concurrency: "unbounded" },
					);
					const storage = {
						authRateLimit: Exit.isSuccess(checks.authRateLimit)
							? "ok"
							: "error",
						controlPlane: Exit.isSuccess(checks.controlPlane) ? "ok" : "error",
						rawMessages: Exit.isSuccess(checks.rawMessages) ? "ok" : "error",
					} as const;
					const healthy = Object.values(storage).every(
						(status) => status === "ok",
					);

					return yield* HttpServerResponse.json(
						{
							service: "backend",
							status: healthy ? "ok" : "degraded",
							storage,
						},
						{ status: healthy ? 200 : 503 },
					);
				}

				return HttpServerResponse.text("Not found", { status: 404 });
			}),
		};
	}).pipe(
		Effect.provide(Cloudflare.D1.QueryDatabaseBinding),
		Effect.provide(Cloudflare.R2.ReadWriteBucketBinding),
	),
) {}
