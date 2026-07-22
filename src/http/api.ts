import { AccountRecoveryGroup } from "./account-recovery-contract";
import { ApplicationAuthHttpApi } from "./auth-contract";
import { DevEmailGroup } from "./dev-email-contract";
import { ExternalRecoveryIdentityGroup } from "./external-recovery-identity-contract";
import { HealthGroup } from "./health-contract";
import { MailboxGroup } from "./mailbox-contract";
import { PasskeyAuthenticationGroup } from "./passkey-authentication-contract";
import { PasskeyCredentialManagementGroup } from "./passkey-credential-management-contract";
import { PasskeyEnrollmentGroup } from "./passkey-enrollment-contract";
import { RecoveryCodeManagementGroup } from "./recovery-code-management-contract";
import { RecoveryPasskeyEnrollmentGroup } from "./recovery-passkey-enrollment-contract";

/** The complete private Worker contract. Every route is registered by one builder. */
export const BackendHttpApi = ApplicationAuthHttpApi.add(
  AccountRecoveryGroup,
  HealthGroup,
  MailboxGroup,
  DevEmailGroup,
  ExternalRecoveryIdentityGroup,
  PasskeyEnrollmentGroup,
  PasskeyAuthenticationGroup,
  PasskeyCredentialManagementGroup,
  RecoveryCodeManagementGroup,
  RecoveryPasskeyEnrollmentGroup
);
