import { AccountRecoveryGroup } from "#/modules/account-security/adapters/http/AccountRecoveryHttpApi";
import { ApplicationAuthHttpApi } from "#/modules/account-security/adapters/http/AccountSecurityAuthHttpApi";
import { DevEmailGroup } from "#/modules/account-security/adapters/http/DevEmailHttpApi";
import { ExternalRecoveryIdentityGroup } from "#/modules/account-security/adapters/http/ExternalRecoveryIdentityHttpApi";
import { PasskeyAuthenticationGroup } from "#/modules/account-security/adapters/http/PasskeyAuthenticationHttpApi";
import { PasskeyCredentialManagementGroup } from "#/modules/account-security/adapters/http/PasskeyCredentialManagementHttpApi";
import { PasskeyEnrollmentGroup } from "#/modules/account-security/adapters/http/PasskeyEnrollmentHttpApi";
import { RecoveryCodeManagementGroup } from "#/modules/account-security/adapters/http/RecoveryCodeManagementHttpApi";
import { RecoveryPasskeyEnrollmentGroup } from "#/modules/account-security/adapters/http/RecoveryPasskeyEnrollmentHttpApi";
import { BackendHealthGroup } from "#/platform/observability/http/BackendHealthHttpApi";

import { MailboxGroup } from "./BackendMailboxHttpApi";

/** The complete private Worker contract. Every route is registered by one builder. */
export const BackendHttpApi = ApplicationAuthHttpApi.add(
  AccountRecoveryGroup,
  BackendHealthGroup,
  MailboxGroup,
  DevEmailGroup,
  ExternalRecoveryIdentityGroup,
  PasskeyEnrollmentGroup,
  PasskeyAuthenticationGroup,
  PasskeyCredentialManagementGroup,
  RecoveryCodeManagementGroup,
  RecoveryPasskeyEnrollmentGroup
);
