import { HttpApi } from "effect/unstable/httpapi";

import { AccountRecoveryGroup } from "./AccountRecoveryHttpApi";
import { ExternalRecoveryIdentityGroup } from "./ExternalRecoveryIdentityHttpApi";
import { PasskeyCredentialManagementGroup } from "./PasskeyCredentialManagementHttpApi";
import { PasskeyEnrollmentGroup } from "./PasskeyEnrollmentHttpApi";
import { RecoveryCodeManagementGroup } from "./RecoveryCodeManagementHttpApi";
import {
  RecoveryPasskeyEnrollmentGroup,
  RecoveryPasskeyEnrollmentReadbackGroup,
} from "./RecoveryPasskeyEnrollmentHttpApi";

export const ApplicationAuthClientExtensionApi = HttpApi.make(
  "applicationAuthClientExtension"
).add(
  ExternalRecoveryIdentityGroup,
  AccountRecoveryGroup,
  PasskeyCredentialManagementGroup,
  RecoveryCodeManagementGroup,
  RecoveryPasskeyEnrollmentGroup,
  RecoveryPasskeyEnrollmentReadbackGroup,
  PasskeyEnrollmentGroup
);
