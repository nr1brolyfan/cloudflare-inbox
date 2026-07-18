import { createFileRoute } from "@tanstack/react-router";
import { env } from "../../server/env";

export const Route = createFileRoute("/api/health")({
	server: {
		handlers: {
			GET: ({ request }) => env.BACKEND.fetch(request),
		},
	},
});
