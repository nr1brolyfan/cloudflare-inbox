import { HttpApi } from "effect/unstable/httpapi";

import { AccountRecoveryGroup } from "./AccountRecoveryHttpApi";
import { ExternalRecoveryIdentityGroup } from "./ExternalRecoveryIdentityHttpApi";
import { PasskeyCredentialManagementGroup } from "./PasskeyCredentialManagementHttpApi";
import { RecoveryCodeManagementGroup } from "./RecoveryCodeManagementHttpApi";
import { RecoveryPasskeyEnrollmentGroup } from "./RecoveryPasskeyEnrollmentHttpApi";

export const ApplicationAuthClientExtensionApi = HttpApi.make(
  "applicationAuthClientExtension"
).add(
  ExternalRecoveryIdentityGroup,
  AccountRecoveryGroup,
  PasskeyCredentialManagementGroup,
  RecoveryCodeManagementGroup,
  RecoveryPasskeyEnrollmentGroup
);
