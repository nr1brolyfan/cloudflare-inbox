import * as Context from "effect/Context";

import type { UserMailboxContactPreferencesService } from "#/modules/organization/application/UserMailboxContactPreferences";

export class UserMailboxContactPreferenceStore extends Context.Service<
  UserMailboxContactPreferenceStore,
  UserMailboxContactPreferencesService
>()("cloudflare-inbox/UserMailboxContactPreferenceStore") {}
