import { CoreAuthHttpApi } from "@effect-auth/core/HttpApi";

import { DevEmailGroup } from "./dev-email-contract";
import { HealthGroup } from "./health-contract";
import { MailboxGroup } from "./mailbox-contract";

/** The complete private Worker contract. Every route is registered by one builder. */
export const BackendHttpApi = CoreAuthHttpApi.add(
  HealthGroup,
  MailboxGroup,
  DevEmailGroup
);
