import {
	type EmailMessage,
	EmailSendError,
	Mailer,
} from "@effect-auth/core/Mailer";
import type { RuntimeContext } from "alchemy";
import type * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export type D1OutboxDatabase = Effect.Success<
	ReturnType<typeof Cloudflare.D1.QueryDatabase>
>;

const insertEmail = `
	insert into app_auth_email_outbox (
		id,
		created_at,
		from_json,
		to_json,
		cc_json,
		bcc_json,
		reply_to_json,
		subject,
		text_body,
		html_body,
		headers_json
	) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const encode = (value: unknown): string | null =>
	value === undefined ? null : JSON.stringify(value);

// Alchemy clients are runtime-colored but close over their Worker binding.
const eraseRuntimeContext = <A, E>(
	effect: Effect.Effect<A, E, RuntimeContext>,
): Effect.Effect<A, E> => effect as Effect.Effect<A, E>;

export const D1OutboxMailerLive = (
	database: D1OutboxDatabase,
): Layer.Layer<Mailer> =>
	Layer.effect(
		Mailer,
		Effect.succeed(
			Mailer.of({
				send: (message: EmailMessage) =>
					eraseRuntimeContext(
						database
							.prepare(insertEmail)
							.bind(
								crypto.randomUUID(),
								Date.now(),
								encode(message.from),
								encode(message.to),
								encode(message.cc),
								encode(message.bcc),
								encode(message.replyTo),
								message.subject,
								message.text ?? null,
								message.html ?? null,
								JSON.stringify(message.headers ?? {}),
							)
							.run(),
					).pipe(
						Effect.asVoid,
						Effect.catchCause((cause) =>
							Effect.fail(
								new EmailSendError({
									cause,
									message: "Failed to persist auth email",
									provider: "d1-auth-email-outbox",
								}),
							),
						),
					),
			}),
		),
	);
