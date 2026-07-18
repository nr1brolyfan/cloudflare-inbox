import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { authClient, authErrorMessage } from "../../auth/client";
import { CompletionShell } from "../../auth/completion-shell";

const readString = (value: unknown) =>
	typeof value === "string" ? value : undefined;

export const Route = createFileRoute("/auth-complete/email-verification")({
	validateSearch: (search: Record<string, unknown>) => ({
		challengeId: readString(search.challengeId) ?? "",
		secret: readString(search.secret),
	}),
	component: EmailVerificationCompletion,
});

function EmailVerificationCompletion() {
	const search = Route.useSearch();
	const [credentials] = useState(search);
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	useEffect(() => {
		window.history.replaceState({}, "", window.location.pathname);
	}, []);

	const verify = useMutation({
		mutationFn: () =>
			authClient.emailVerification.verify({
				challengeId: credentials.challengeId,
				...(credentials.secret ? { secret: credentials.secret } : {}),
			}),
		retry: false,
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
			await navigate({ to: "/" });
		},
	});

	return (
		<CompletionShell
			title="Verify your address"
			description="Confirm this email address to remove limited-session restrictions from your account."
			action="Verify email"
			isReady={Boolean(credentials.challengeId)}
			isPending={verify.isPending}
			error={verify.error ? authErrorMessage(verify.error) : undefined}
			onSubmit={() => verify.mutate()}
		/>
	);
}
