import { ApplicationAuthHttpApi } from "./auth-contract";
import { DevEmailGroup } from "./dev-email-contract";
import { ExternalRecoveryIdentityGroup } from "./external-recovery-identity-contract";
import { HealthGroup } from "./health-contract";
import { MailboxGroup } from "./mailbox-contract";
import { PasskeyEnrollmentGroup } from "./passkey-enrollment-contract";

/** The complete private Worker contract. Every route is registered by one builder. */
export const BackendHttpApi = ApplicationAuthHttpApi.add(
  HealthGroup,
  MailboxGroup,
  DevEmailGroup,
  ExternalRecoveryIdentityGroup,
  PasskeyEnrollmentGroup
);
