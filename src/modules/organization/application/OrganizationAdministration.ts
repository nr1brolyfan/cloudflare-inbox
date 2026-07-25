/* oxlint-disable max-classes-per-file -- Lifecycle commands, receipt, error, and service form one boundary. */
import { UserIdSchema } from "@effect-auth/core/Identifiers";
import type * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { AdministrativeAuditEventId } from "#/modules/administrative-audit/contracts/AdministrativeAudit";
import {
  ORGANIZATION_OPERATION_MATRIX_ID,
  ORGANIZATION_OPERATION_MATRIX_VERSION,
  OrganizationId,
  OrganizationSchema,
} from "#/modules/organization/domain/Organization";
import { OrganizationAdministrationTransaction } from "#/modules/organization/ports/OrganizationAdministrationTransaction";
import { AdministrativeOperationId } from "#/shared/Operation";
import type { CurrentRequestAuth } from "#/shared/RequestAuth";
import type { RequestCorrelation } from "#/shared/RequestCorrelation";
import { UnixMillis, Version } from "#/shared/Temporal";

const OrganizationLifecycleCommandFields = {
  expectedVersion: Version,
  operationId: AdministrativeOperationId,
  organizationId: OrganizationId,
};

export const SuspendOrganizationCommand = Schema.Struct(
  OrganizationLifecycleCommandFields
);
export type SuspendOrganizationCommand = Schema.Schema.Type<
  typeof SuspendOrganizationCommand
>;

export const ResumeOrganizationCommand = Schema.Struct(
  OrganizationLifecycleCommandFields
);
export type ResumeOrganizationCommand = Schema.Schema.Type<
  typeof ResumeOrganizationCommand
>;

export const ReadOrganizationAdministrationOperationQuery = Schema.Struct({
  operationId: AdministrativeOperationId,
});
export type ReadOrganizationAdministrationOperationQuery = Schema.Schema.Type<
  typeof ReadOrganizationAdministrationOperationQuery
>;

export class OrganizationAdministrationReceipt extends Schema.Class<OrganizationAdministrationReceipt>(
  "cloudflare-inbox/OrganizationAdministrationReceipt"
)({
  actorUserId: UserIdSchema,
  auditEventId: AdministrativeAuditEventId,
  committedAt: UnixMillis,
  expectedVersion: Version,
  matrixId: Schema.Literal(ORGANIZATION_OPERATION_MATRIX_ID),
  matrixVersion: Schema.Literal(ORGANIZATION_OPERATION_MATRIX_VERSION),
  operationId: AdministrativeOperationId,
  operationKind: Schema.Literals(["suspend", "resume"]),
  organizationId: OrganizationId,
  result: OrganizationSchema,
  schemaVersion: Schema.Literal(1),
  stepUpPolicyId: Schema.Literal("control-plane-sensitive"),
  stepUpPolicyVersion: Schema.Literal(1),
}) {}

export const OrganizationAdministrationReceiptSchema =
  OrganizationAdministrationReceipt.check(
    Schema.makeFilter((receipt) => {
      const expectedStatus =
        receipt.operationKind === "suspend" ? "suspended" : "active";
      return receipt.result.id === receipt.organizationId &&
        receipt.result.status === expectedStatus &&
        receipt.result.version === receipt.expectedVersion + 1 &&
        receipt.result.updatedAt === receipt.committedAt
        ? undefined
        : "organization lifecycle receipt intent and result must agree";
    })
  );

export type OrganizationAdministrationOperation =
  | "read-operation"
  | "resume"
  | "suspend";
export type OrganizationAdministrationCommitState =
  | "not-committed"
  | "committed"
  | "unknown";

export class OrganizationAdministrationError extends Data.TaggedError(
  "OrganizationAdministrationError"
)<{
  readonly cause?: unknown;
  readonly commitState?: OrganizationAdministrationCommitState;
  readonly message: string;
  readonly operation: OrganizationAdministrationOperation;
  readonly permission?: AuthPermission.PermissionId;
  readonly reason:
    | "authorization-recheck"
    | "conflict"
    | "invalid-input"
    | "membership-recheck"
    | "not-found"
    | "operation-conflict"
    | "session-recheck"
    | "step-up-required"
    | "storage";
  readonly scope?: AuthPermission.PermissionScope;
}> {}

export interface OrganizationAdministrationService {
  readonly readOperation: (
    input: ReadOrganizationAdministrationOperationQuery
  ) => Effect.Effect<
    OrganizationAdministrationReceipt,
    OrganizationAdministrationError,
    AuthPermission.CurrentPrincipal | CurrentRequestAuth | RequestCorrelation
  >;
  readonly resume: (
    input: ResumeOrganizationCommand
  ) => Effect.Effect<
    Schema.Schema.Type<typeof OrganizationSchema>,
    OrganizationAdministrationError,
    AuthPermission.CurrentPrincipal | CurrentRequestAuth | RequestCorrelation
  >;
  readonly suspend: (
    input: SuspendOrganizationCommand
  ) => Effect.Effect<
    Schema.Schema.Type<typeof OrganizationSchema>,
    OrganizationAdministrationError,
    AuthPermission.CurrentPrincipal | CurrentRequestAuth | RequestCorrelation
  >;
}

export class OrganizationAdministration extends Context.Service<
  OrganizationAdministration,
  OrganizationAdministrationService
>()("cloudflare-inbox/OrganizationAdministration", {
  make: Effect.gen(function* () {
    return yield* OrganizationAdministrationTransaction;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
