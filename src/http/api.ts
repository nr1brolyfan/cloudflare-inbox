import { AccountRecoveryGroup } from "#/modules/account-security/adapters/http/AccountRecoveryHttpApi";
import { ApplicationAuthHttpApi } from "#/modules/account-security/adapters/http/AccountSecurityAuthHttpApi";
import { DevEmailGroup } from "#/modules/account-security/adapters/http/DevEmailHttpApi";
import { ExternalRecoveryIdentityGroup } from "#/modules/account-security/adapters/http/ExternalRecoveryIdentityHttpApi";
import { PasskeyAuthenticationGroup } from "#/modules/account-security/adapters/http/PasskeyAuthenticationHttpApi";
import { PasskeyCredentialManagementGroup } from "#/modules/account-security/adapters/http/PasskeyCredentialManagementHttpApi";
import { PasskeyEnrollmentGroup } from "#/modules/account-security/adapters/http/PasskeyEnrollmentHttpApi";
import { RecoveryCodeManagementGroup } from "#/modules/account-security/adapters/http/RecoveryCodeManagementHttpApi";
import { RecoveryPasskeyEnrollmentGroup } from "#/modules/account-security/adapters/http/RecoveryPasskeyEnrollmentHttpApi";
import { MailboxGroup } from "#/modules/mailbox/adapters/http/MailboxHttpApi";

import { HealthGroup } from "./health-contract";

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
