import { HttpApi } from "effect/unstable/httpapi";

import { ExternalRecoveryIdentityGroup } from "./external-recovery-identity-contract";
import { PasskeyCredentialManagementGroup } from "./passkey-credential-management-contract";
import { RecoveryCodeManagementGroup } from "./recovery-code-management-contract";

export const ApplicationAuthClientExtensionApi = HttpApi.make(
  "applicationAuthClientExtension"
).add(
  ExternalRecoveryIdentityGroup,
  PasskeyCredentialManagementGroup,
  RecoveryCodeManagementGroup
);
