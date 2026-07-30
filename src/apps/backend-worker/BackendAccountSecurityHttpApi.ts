import { AccountRecoveryGroup } from "#/modules/account-security/adapters/http/AccountRecoveryHttpApi";
import { ApplicationAuthHttpApi } from "#/modules/account-security/adapters/http/AccountSecurityAuthHttpApi";
import { DevEmailGroup } from "#/modules/account-security/adapters/http/DevEmailHttpApi";
import { ExternalRecoveryIdentityGroup } from "#/modules/account-security/adapters/http/ExternalRecoveryIdentityHttpApi";
import { FirstOwnerPasswordEnrollmentGroup } from "#/modules/account-security/adapters/http/FirstOwnerPasswordEnrollmentHttpApi";
import { PasskeyAuthenticationGroup } from "#/modules/account-security/adapters/http/PasskeyAuthenticationHttpApi";
import { PasskeyCredentialManagementGroup } from "#/modules/account-security/adapters/http/PasskeyCredentialManagementHttpApi";
import { PasskeyEnrollmentGroup } from "#/modules/account-security/adapters/http/PasskeyEnrollmentHttpApi";
import { RecoveryCodeManagementGroup } from "#/modules/account-security/adapters/http/RecoveryCodeManagementHttpApi";
import {
  RecoveryPasskeyEnrollmentGroup,
  RecoveryPasskeyEnrollmentReadbackGroup,
} from "#/modules/account-security/adapters/http/RecoveryPasskeyEnrollmentHttpApi";

/** Complete account-security contract without mailbox and organization routes. */
export const BackendAccountSecurityHttpApi = ApplicationAuthHttpApi.add(
  AccountRecoveryGroup,
  DevEmailGroup,
  ExternalRecoveryIdentityGroup,
  FirstOwnerPasswordEnrollmentGroup,
  PasskeyEnrollmentGroup,
  PasskeyAuthenticationGroup,
  PasskeyCredentialManagementGroup,
  RecoveryCodeManagementGroup,
  RecoveryPasskeyEnrollmentGroup,
  RecoveryPasskeyEnrollmentReadbackGroup
);
