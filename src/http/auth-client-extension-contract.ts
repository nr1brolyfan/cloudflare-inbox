import { HttpApi } from "effect/unstable/httpapi";

import { AccountRecoveryGroup } from "./account-recovery-contract";
import { ExternalRecoveryIdentityGroup } from "./external-recovery-identity-contract";
import { PasskeyCredentialManagementGroup } from "./passkey-credential-management-contract";
import { RecoveryCodeManagementGroup } from "./recovery-code-management-contract";
import { RecoveryPasskeyEnrollmentGroup } from "./recovery-passkey-enrollment-contract";

export const ApplicationAuthClientExtensionApi = HttpApi.make(
  "applicationAuthClientExtension"
).add(
  ExternalRecoveryIdentityGroup,
  AccountRecoveryGroup,
  PasskeyCredentialManagementGroup,
  RecoveryCodeManagementGroup,
  RecoveryPasskeyEnrollmentGroup
);
