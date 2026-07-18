import { createFileRoute } from "@tanstack/react-router";
import { env } from "../../server/env";

export const Route = createFileRoute("/auth/$")({
	server: {
		handlers: {
			ANY: ({ request }) => env.BACKEND.fetch(request),
		},
	},
});
