/* oxlint-disable max-classes-per-file -- The preference service and its bounded application error form one use-case contract. */
import type { CurrentPrincipal } from "@effect-auth/core/Permission";
import type { CurrentActor } from "@effect-auth/core/Sessions";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import type { MailboxAuthorizationError } from "#/modules/mailbox/ports/MailboxAuthorization";
import { UserMailboxContactPreferenceStore } from "#/modules/organization/ports/UserMailboxContactPreferenceStore";
import { UnixMillis } from "#/shared/Temporal";

export const ContactSuggestionVisibility = Schema.Literals([
  "safe",
  "all-participants",
]);
export type ContactSuggestionVisibility = Schema.Schema.Type<
  typeof ContactSuggestionVisibility
>;

export const ContactPreferenceVersion = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
);

export const MailboxContactPreference = Schema.Struct({
  allParticipantsEnabledAt: Schema.NullOr(UnixMillis),
  mailboxId: MailboxId,
  version: ContactPreferenceVersion,
  visibility: ContactSuggestionVisibility,
});
export type MailboxContactPreference = Schema.Schema.Type<
  typeof MailboxContactPreference
>;

export const GetMailboxContactPreferenceQuery = Schema.Struct({
  mailboxId: MailboxId,
});
export type GetMailboxContactPreferenceQuery = Schema.Schema.Type<
  typeof GetMailboxContactPreferenceQuery
>;

export const UpdateMailboxContactPreferenceCommand = Schema.Struct({
  expectedVersion: ContactPreferenceVersion,
  mailboxId: MailboxId,
  visibility: ContactSuggestionVisibility,
});
export type UpdateMailboxContactPreferenceCommand = Schema.Schema.Type<
  typeof UpdateMailboxContactPreferenceCommand
>;

export class UserMailboxContactPreferenceError extends Data.TaggedError(
  "UserMailboxContactPreferenceError"
)<{
  readonly reason: "conflict" | "not-found" | "storage";
  readonly cause?: unknown;
}> {}

export interface UserMailboxContactPreferencesService {
  readonly get: (
    query: GetMailboxContactPreferenceQuery
  ) => Effect.Effect<
    MailboxContactPreference,
    MailboxAuthorizationError | UserMailboxContactPreferenceError,
    CurrentActor | CurrentPrincipal
  >;
  readonly update: (
    command: UpdateMailboxContactPreferenceCommand
  ) => Effect.Effect<
    MailboxContactPreference,
    MailboxAuthorizationError | UserMailboxContactPreferenceError,
    CurrentActor | CurrentPrincipal
  >;
}

export class UserMailboxContactPreferences extends Context.Service<
  UserMailboxContactPreferences,
  UserMailboxContactPreferencesService
>()("cloudflare-inbox/UserMailboxContactPreferences", {
  make: Effect.gen(function* () {
    return yield* UserMailboxContactPreferenceStore;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
