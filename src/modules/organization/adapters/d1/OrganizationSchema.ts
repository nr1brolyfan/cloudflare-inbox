import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { authUser } from "#/auth/schema/modules/core";
import { authRoleGrant } from "#/auth/schema/modules/permissions";
import { administrativeAuditEventIdReference } from "#/modules/administrative-audit/integration/AdministrativeAuditD1Statements";
import type { CanonicalMailDomain } from "#/modules/organization/domain/MailDomain";

export const appOrganization = sqliteTable(
  "app_organization",
  {
    id: text("id").notNull(),
    status: text("status", { enum: ["active", "suspended"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    primaryKey({ name: "app_organization_pkey", columns: [t.id] }),
    check(
      "app_organization_id_check",
      sql`typeof(id) = 'text'
        and length(id) between 1 and 128
        and length(cast(id as blob)) = length(id)
        and id not glob '*[^A-Za-z0-9_-]*'`
    ),
    check(
      "app_organization_status_check",
      sql`status in ('active', 'suspended')`
    ),
    check(
      "app_organization_created_at_check",
      sql`typeof(created_at) = 'integer'
        and created_at between 0 and 9007199254740991`
    ),
    check(
      "app_organization_updated_at_check",
      sql`typeof(updated_at) = 'integer'
        and updated_at between created_at and 9007199254740991`
    ),
    check(
      "app_organization_version_check",
      sql`typeof(version) = 'integer'
        and version between 1 and 9007199254740991`
    ),
    index("app_organization_status_idx").on(t.status, t.id),
  ]
);

export const appMailDomain = sqliteTable(
  "app_mail_domain",
  {
    id: text("id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => appOrganization.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    canonicalDomain: text("canonical_domain")
      .notNull()
      .$type<CanonicalMailDomain>(),
    canonicalizationProfileId: text("canonicalization_profile_id", {
      enum: [
        "mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1",
      ],
    }).notNull(),
    canonicalizationVersion: integer("canonicalization_version")
      .notNull()
      .default(1),
    status: text("status", {
      enum: [
        "pending_verification",
        "verified",
        "active",
        "suspended",
        "retired",
      ],
    })
      .notNull()
      .default("pending_verification"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    primaryKey({ name: "app_mail_domain_pkey", columns: [t.id] }),
    check(
      "app_mail_domain_id_check",
      sql`typeof(id) = 'text'
        and length(id) between 1 and 128
        and length(cast(id as blob)) = length(id)
        and id not glob '*[^A-Za-z0-9_-]*'`
    ),
    check(
      "app_mail_domain_organization_id_check",
      sql`typeof(organization_id) = 'text' and length(organization_id) > 0`
    ),
    check(
      "app_mail_domain_canonical_domain_check",
      sql`typeof(canonical_domain) = 'text'
        and length(canonical_domain) between 3 and 253
        and length(cast(canonical_domain as blob)) = length(canonical_domain)
        and canonical_domain = lower(canonical_domain)
        and canonical_domain not glob '*[^a-z0-9.-]*'
        and canonical_domain glob '*.*'
        and canonical_domain not like '.%'
        and canonical_domain not like '%.'
        and canonical_domain not like '%..%'
        and canonical_domain not like '-%'
        and canonical_domain not like '%-'
        and canonical_domain not like '%.-%'
        and canonical_domain not like '%-.%'
        and substr(canonical_domain, instr(canonical_domain, '.') + 1) <> ''`
    ),
    check(
      "app_mail_domain_profile_check",
      sql`typeof(canonicalization_profile_id) = 'text'
        and canonicalization_profile_id = 'mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1'`
    ),
    check(
      "app_mail_domain_canonicalization_version_check",
      sql`typeof(canonicalization_version) = 'integer'
        and canonicalization_version = 1`
    ),
    check(
      "app_mail_domain_status_check",
      sql`typeof(status) = 'text'
        and status in ('pending_verification', 'verified', 'active', 'suspended', 'retired')`
    ),
    check(
      "app_mail_domain_created_at_check",
      sql`typeof(created_at) = 'integer'
        and created_at between 0 and 9007199254740991`
    ),
    check(
      "app_mail_domain_updated_at_check",
      sql`typeof(updated_at) = 'integer'
        and updated_at between created_at and 9007199254740991`
    ),
    check(
      "app_mail_domain_version_check",
      sql`typeof(version) = 'integer'
        and version between 1 and 9007199254740991`
    ),
    uniqueIndex("app_mail_domain_current_canonical_idx")
      .on(t.canonicalDomain)
      .where(sql`status <> 'retired'`),
    index("app_mail_domain_organization_status_idx").on(
      t.organizationId,
      t.status,
      t.id
    ),
    index("app_mail_domain_canonical_history_idx").on(
      t.canonicalDomain,
      t.status,
      t.updatedAt,
      t.id
    ),
  ]
);

export const appOrganizationMember = sqliteTable(
  "app_organization_member",
  {
    id: text("id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => appOrganization.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    status: text("status", { enum: ["active", "suspended", "revoked"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    suspendedAt: integer("suspended_at"),
    revokedAt: integer("revoked_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    primaryKey({ name: "app_organization_member_pkey", columns: [t.id] }),
    check(
      "app_organization_member_id_check",
      sql`typeof(id) = 'text'
        and length(id) between 1 and 128
        and length(cast(id as blob)) = length(id)
        and id not glob '*[^A-Za-z0-9_-]*'`
    ),
    check(
      "app_organization_member_organization_id_check",
      sql`typeof(organization_id) = 'text' and length(organization_id) > 0`
    ),
    check(
      "app_organization_member_user_id_check",
      sql`typeof(user_id) = 'text' and length(user_id) > 0`
    ),
    check(
      "app_organization_member_status_check",
      sql`typeof(status) = 'text'
        and status in ('active', 'suspended', 'revoked')`
    ),
    check(
      "app_organization_member_created_at_check",
      sql`typeof(created_at) = 'integer'
        and created_at between 0 and 9007199254740991`
    ),
    check(
      "app_organization_member_updated_at_check",
      sql`typeof(updated_at) = 'integer'
        and updated_at between created_at and 9007199254740991`
    ),
    check(
      "app_organization_member_suspended_at_check",
      sql`suspended_at is null
        or (typeof(suspended_at) = 'integer'
          and suspended_at between created_at and 9007199254740991)`
    ),
    check(
      "app_organization_member_revoked_at_check",
      sql`revoked_at is null
        or (typeof(revoked_at) = 'integer'
          and revoked_at between created_at and 9007199254740991)`
    ),
    check(
      "app_organization_member_version_check",
      sql`typeof(version) = 'integer'
        and version between 1 and 9007199254740991`
    ),
    check(
      "app_organization_member_lifecycle_check",
      sql`(status = 'active'
          and suspended_at is null
          and revoked_at is null)
        or (status = 'suspended'
          and suspended_at is updated_at
          and revoked_at is null)
        or (status = 'revoked'
          and revoked_at is updated_at
          and (suspended_at is null
            or suspended_at between created_at and revoked_at))`
    ),
    uniqueIndex("app_organization_member_current_pair_idx")
      .on(t.organizationId, t.userId)
      .where(sql`status in ('active', 'suspended')`),
    index("app_organization_member_user_status_org_idx").on(
      t.userId,
      t.status,
      t.organizationId,
      t.id
    ),
    index("app_organization_member_org_status_idx").on(
      t.organizationId,
      t.status,
      t.id
    ),
  ]
);

export const appMailbox = sqliteTable(
  "app_mailbox",
  {
    id: text("id").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status", {
      enum: ["active", "suspended", "deleting", "deleted"],
    })
      .notNull()
      .default("active"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    primaryKey({ name: "app_mailbox_pkey", columns: [t.id] }),
    check("app_mailbox_id_check", sql`length(id) between 1 and 128`),
    check(
      "app_mailbox_display_name_check",
      sql`length(display_name) between 1 and 200`
    ),
    check(
      "app_mailbox_status_check",
      sql`status in ('active', 'suspended', 'deleting', 'deleted')`
    ),
    check(
      "app_mailbox_created_by_user_id_check",
      sql`length(created_by_user_id) between 1 and 128`
    ),
    check("app_mailbox_created_at_check", sql`created_at >= 0`),
    check("app_mailbox_updated_at_check", sql`updated_at >= created_at`),
    check(
      "app_mailbox_deleted_at_check",
      sql`deleted_at is null or deleted_at >= created_at`
    ),
    check("app_mailbox_version_check", sql`version >= 1`),
    check(
      "app_mailbox_deleted_state",
      sql`(status = 'deleted' and deleted_at is not null)
        or (status <> 'deleted' and deleted_at is null)`
    ),
    index("app_mailbox_active_idx")
      .on(t.status, t.id)
      .where(sql`deleted_at is null`),
    index("app_mailbox_creator_idx").on(t.createdByUserId, t.createdAt),
    uniqueIndex("app_mailbox_singleton_idx").on(sql`(1)`),
  ]
);

export const appOrganizationLegacyCutover = sqliteTable(
  "app_organization_legacy_cutover",
  {
    id: integer("id").primaryKey(),
    schemaVersion: integer("schema_version").notNull(),
    outcome: text("outcome", {
      enum: ["legacy-primary", "fresh-empty"],
    }).notNull(),
    sourceMailboxId: text("source_mailbox_id").references(() => appMailbox.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    sourceCreatedAt: integer("source_created_at"),
    organizationId: text("organization_id").references(
      () => appOrganization.id,
      { onDelete: "restrict", onUpdate: "restrict" }
    ),
  },
  () => [
    check("app_organization_legacy_cutover_id_check", sql`id = 1`),
    check(
      "app_organization_legacy_cutover_schema_check",
      sql`typeof(schema_version) = 'integer' and schema_version = 1`
    ),
    check(
      "app_organization_legacy_cutover_outcome_check",
      sql`(outcome = 'legacy-primary'
          and typeof(outcome) = 'text'
          and source_mailbox_id = 'primary'
          and typeof(source_mailbox_id) = 'text'
          and typeof(source_created_at) = 'integer'
          and source_created_at between 0 and 9007199254740991
          and organization_id = 'legacy_default_v1'
          and typeof(organization_id) = 'text')
        or (outcome = 'fresh-empty'
          and typeof(outcome) = 'text'
          and source_mailbox_id is null
          and source_created_at is null
          and organization_id is null)`
    ),
  ]
);

export const appMailboxLegacyOrganizationAssignment = sqliteTable(
  "app_mailbox_legacy_organization_assignment",
  {
    mailboxId: text("mailbox_id")
      .notNull()
      .primaryKey()
      .references(() => appMailbox.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => appOrganization.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    effectiveAt: integer("effective_at").notNull(),
    source: text("source", {
      enum: ["legacy-cutover", "fresh-bootstrap"],
    }).notNull(),
    schemaVersion: integer("schema_version").notNull(),
  },
  () => [
    check(
      "app_mailbox_legacy_organization_assignment_mailbox_check",
      sql`typeof(mailbox_id) = 'text' and mailbox_id = 'primary'`
    ),
    check(
      "app_mailbox_legacy_organization_assignment_organization_check",
      sql`typeof(organization_id) = 'text'
        and organization_id = 'legacy_default_v1'`
    ),
    check(
      "app_mailbox_legacy_organization_assignment_effective_check",
      sql`typeof(effective_at) = 'integer'
        and effective_at between 0 and 9007199254740991`
    ),
    check(
      "app_mailbox_legacy_organization_assignment_source_check",
      sql`typeof(source) = 'text'
        and source in ('legacy-cutover', 'fresh-bootstrap')`
    ),
    check(
      "app_mailbox_legacy_organization_assignment_schema_check",
      sql`typeof(schema_version) = 'integer' and schema_version = 1`
    ),
  ]
);

export const appMailboxLegacyOrganizationAssignmentCutover = sqliteTable(
  "app_mailbox_legacy_organization_assignment_cutover",
  {
    id: integer("id").primaryKey(),
    schemaVersion: integer("schema_version").notNull(),
  },
  () => [
    check(
      "app_mailbox_legacy_organization_assignment_cutover_id_check",
      sql`id = 1`
    ),
    check(
      "app_mailbox_legacy_organization_assignment_cutover_schema_check",
      sql`typeof(schema_version) = 'integer' and schema_version = 1`
    ),
  ]
);

export const appOrganizationOwnerAssignmentCutover = sqliteTable(
  "app_organization_owner_assignment_cutover",
  {
    id: integer("id").primaryKey(),
    schemaVersion: integer("schema_version").notNull(),
  },
  () => [
    check("app_organization_owner_assignment_cutover_id_check", sql`id = 1`),
    check(
      "app_organization_owner_assignment_cutover_schema_check",
      sql`typeof(schema_version) = 'integer' and schema_version = 1`
    ),
  ]
);

export const appMailboxMember = sqliteTable(
  "app_mailbox_member",
  {
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => appMailbox.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    revokedAt: integer("revoked_at"),
  },
  (t) => [
    primaryKey({
      name: "app_mailbox_member_pkey",
      columns: [t.mailboxId, t.userId],
    }),
    check(
      "app_mailbox_member_user_id_check",
      sql`length(user_id) between 1 and 128`
    ),
    check("app_mailbox_member_created_at_check", sql`created_at >= 0`),
    check("app_mailbox_member_updated_at_check", sql`updated_at >= created_at`),
    check(
      "app_mailbox_member_revoked_at_check",
      sql`revoked_at is null or revoked_at >= created_at`
    ),
    index("app_mailbox_member_user_active_idx")
      .on(t.userId, t.mailboxId)
      .where(sql`revoked_at is null`),
  ]
);

export const appMailboxAdministrationReceipt = sqliteTable(
  "app_mailbox_administration_receipt",
  {
    operationId: text("operation_id").primaryKey(),
    operationKind: text("operation_kind", {
      enum: ["bootstrap-owner", "rename"],
    }).notNull(),
    actorUserId: text("actor_user_id").notNull(),
    mailboxId: text("mailbox_id").notNull(),
    displayName: text("display_name").notNull(),
    expectedVersion: integer("expected_version"),
    resultMailboxId: text("result_mailbox_id").notNull(),
    resultDisplayName: text("result_display_name").notNull(),
    resultStatus: text("result_status", { enum: ["active"] }).notNull(),
    resultCreatedByUserId: text("result_created_by_user_id").notNull(),
    resultCreatedAt: integer("result_created_at").notNull(),
    resultUpdatedAt: integer("result_updated_at").notNull(),
    resultVersion: integer("result_version").notNull(),
    committedAt: integer("committed_at").notNull(),
    schemaVersion: integer("schema_version").notNull(),
  },
  (t) => [
    check(
      "app_mailbox_administration_receipt_operation_id_check",
      sql`length(operation_id) = 36
        and operation_id = lower(trim(operation_id))
        and substr(operation_id, 9, 1) = '-'
        and substr(operation_id, 14, 1) = '-'
        and substr(operation_id, 15, 1) = '4'
        and substr(operation_id, 19, 1) = '-'
        and substr(operation_id, 20, 1) in ('8', '9', 'a', 'b')
        and substr(operation_id, 24, 1) = '-'
        and length(replace(operation_id, '-', '')) = 32
        and replace(operation_id, '-', '') not glob '*[^0-9a-f]*'`
    ),
    check(
      "app_mailbox_administration_receipt_kind_check",
      sql`operation_kind in ('bootstrap-owner', 'rename')`
    ),
    check(
      "app_mailbox_administration_receipt_actor_check",
      sql`length(actor_user_id) between 1 and 128
        and actor_user_id = trim(actor_user_id)`
    ),
    check(
      "app_mailbox_administration_receipt_intent_check",
      sql`length(mailbox_id) between 1 and 128
        and length(display_name) between 1 and 200
        and ((operation_kind = 'bootstrap-owner' and expected_version is null)
          or (operation_kind = 'rename' and expected_version >= 1))`
    ),
    check(
      "app_mailbox_administration_receipt_result_check",
      sql`result_mailbox_id = mailbox_id
        and result_display_name = display_name
        and result_status = 'active'
        and length(result_created_by_user_id) between 1 and 128
        and result_created_at >= 0
        and result_updated_at >= result_created_at
        and result_version >= 1
        and committed_at = result_updated_at
        and schema_version = 1`
    ),
    index("app_mailbox_administration_receipt_actor_operation_idx").on(
      t.actorUserId,
      t.operationId
    ),
  ]
);

export const appMailboxBootstrapReceiptV1Intent = sqliteTable(
  "app_mailbox_bootstrap_receipt_v1_intent",
  {
    operationId: text("operation_id")
      .primaryKey()
      .references(() => appMailboxAdministrationReceipt.operationId, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    initialAddress: text("initial_address").notNull(),
  },
  () => [
    check(
      "app_mailbox_bootstrap_receipt_v1_intent_address_check",
      sql`typeof(initial_address) = 'text'
        and length(initial_address) between 3 and 320
        and initial_address = trim(initial_address)
        and instr(initial_address, '@') between 2 and length(initial_address) - 2
        and instr(substr(initial_address, instr(initial_address, '@') + 1), '@') = 0
        and substr(initial_address, instr(initial_address, '@') + 1)
          = lower(substr(initial_address, instr(initial_address, '@') + 1))`
    ),
  ]
);

export const appMailboxBootstrapIntentCutover = sqliteTable(
  "app_mailbox_bootstrap_intent_cutover",
  {
    id: integer("id").primaryKey(),
    schemaVersion: integer("schema_version").notNull(),
  },
  () => [
    check("app_mailbox_bootstrap_intent_cutover_id_check", sql`id = 1`),
    check(
      "app_mailbox_bootstrap_intent_cutover_schema_check",
      sql`schema_version = 1`
    ),
  ]
);

export const appMailboxBootstrapReceiptV2 = sqliteTable(
  "app_mailbox_bootstrap_receipt_v2",
  {
    operationId: text("operation_id")
      .primaryKey()
      .references(() => appMailboxAdministrationReceipt.operationId, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    initialAddress: text("initial_address").notNull(),
    schemaVersion: integer("schema_version").notNull(),
  },
  () => [
    check(
      "app_mailbox_bootstrap_receipt_v2_address_check",
      sql`typeof(initial_address) = 'text'
        and length(initial_address) between 3 and 320
        and initial_address = trim(initial_address)
        and instr(initial_address, '@') between 2 and length(initial_address) - 2
        and instr(substr(initial_address, instr(initial_address, '@') + 1), '@') = 0
        and substr(initial_address, instr(initial_address, '@') + 1)
          = lower(substr(initial_address, instr(initial_address, '@') + 1))`
    ),
    check(
      "app_mailbox_bootstrap_receipt_v2_schema_check",
      sql`typeof(schema_version) = 'integer' and schema_version = 2`
    ),
  ]
);

export const appMailboxBootstrapDomainIntent = sqliteTable(
  "app_mailbox_bootstrap_domain_intent",
  {
    operationId: text("operation_id")
      .primaryKey()
      .references(() => appMailboxAdministrationReceipt.operationId, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    canonicalDomain: text("canonical_domain")
      .notNull()
      .$type<CanonicalMailDomain>(),
    canonicalizationProfileId: text("canonicalization_profile_id", {
      enum: [
        "mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1",
      ],
    }).notNull(),
    canonicalizationVersion: integer("canonicalization_version").notNull(),
    schemaVersion: integer("schema_version").notNull(),
  },
  () => [
    check(
      "app_mailbox_bootstrap_domain_intent_domain_check",
      sql`typeof(canonical_domain) = 'text'
        and length(canonical_domain) between 3 and 253
        and length(cast(canonical_domain as blob)) = length(canonical_domain)
        and canonical_domain = lower(canonical_domain)
        and canonical_domain not glob '*[^a-z0-9.-]*'
        and canonical_domain glob '*.*'
        and canonical_domain not like '.%'
        and canonical_domain not like '%.'
        and canonical_domain not like '%..%'
        and canonical_domain not like '-%'
        and canonical_domain not like '%-'
        and canonical_domain not like '%.-%'
        and canonical_domain not like '%-.%'`
    ),
    check(
      "app_mailbox_bootstrap_domain_intent_profile_check",
      sql`canonicalization_profile_id = 'mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1'
        and canonicalization_version = 1
        and schema_version = 1`
    ),
  ]
);

export const appMailDomainClaimCutover = sqliteTable(
  "app_mail_domain_claim_cutover",
  {
    id: integer("id").primaryKey(),
    schemaVersion: integer("schema_version").notNull(),
    initialOutcome: text("initial_outcome", {
      enum: [
        "fresh-empty",
        "legacy-awaiting-reconciliation",
        "already-bootstrapped-awaiting-reconciliation",
        "complete-pair",
      ],
    }).notNull(),
    initialStatus: text("initial_status", {
      enum: ["awaiting-bootstrap", "awaiting-reconciliation", "complete"],
    }).notNull(),
  },
  () => [
    check("app_mail_domain_claim_cutover_id_check", sql`id = 1`),
    check(
      "app_mail_domain_claim_cutover_schema_check",
      sql`typeof(schema_version) = 'integer' and schema_version = 1`
    ),
    check(
      "app_mail_domain_claim_cutover_outcome_check",
      sql`typeof(initial_outcome) = 'text'
        and initial_outcome in (
          'fresh-empty', 'legacy-awaiting-reconciliation',
          'already-bootstrapped-awaiting-reconciliation', 'complete-pair'
        )`
    ),
    check(
      "app_mail_domain_claim_cutover_status_check",
      sql`(initial_outcome = 'fresh-empty'
          and initial_status = 'awaiting-bootstrap')
        or (initial_outcome in (
          'legacy-awaiting-reconciliation',
          'already-bootstrapped-awaiting-reconciliation'
        ) and initial_status = 'awaiting-reconciliation')
        or (initial_outcome = 'complete-pair'
          and initial_status = 'complete')`
    ),
  ]
);

const appMailboxAddressClaimReference = sqliteTable(
  "app_mailbox_address",
  {
    mailboxId: text("mailbox_id").notNull(),
    id: text("id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.mailboxId, t.id] })]
);

export const appMailDomainClaimReceipt = sqliteTable(
  "app_mail_domain_claim_receipt",
  {
    domainId: text("domain_id")
      .primaryKey()
      .references(() => appMailDomain.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => appOrganization.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    mailboxId: text("mailbox_id").notNull(),
    primaryAddressId: text("primary_address_id").notNull(),
    rawAddressSnapshot: text("raw_address_snapshot").notNull(),
    normalizedAddressSnapshot: text("normalized_address_snapshot").notNull(),
    canonicalDomain: text("canonical_domain")
      .notNull()
      .$type<CanonicalMailDomain>(),
    canonicalizationProfileId: text("canonicalization_profile_id", {
      enum: [
        "mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1",
      ],
    }).notNull(),
    canonicalizationVersion: integer("canonicalization_version").notNull(),
    source: text("source", {
      enum: ["legacy-reconciliation", "fresh-bootstrap"],
    }).notNull(),
    effectiveAt: integer("effective_at").notNull(),
    sourceBootstrapOperationId: text(
      "source_bootstrap_operation_id"
    ).references(() => appMailboxAdministrationReceipt.operationId, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    sourceAuditEventId: text("source_audit_event_id").references(
      administrativeAuditEventIdReference,
      { onDelete: "restrict", onUpdate: "restrict" }
    ),
    schemaVersion: integer("schema_version").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.mailboxId, t.primaryAddressId],
      foreignColumns: [
        appMailboxAddressClaimReference.mailboxId,
        appMailboxAddressClaimReference.id,
      ],
      name: "app_mail_domain_claim_receipt_address_fk",
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    check(
      "app_mail_domain_claim_receipt_identity_check",
      sql`domain_id = 'legacy_default_v1_domain_v1'
        and organization_id = 'legacy_default_v1'
        and mailbox_id = 'primary'
        and primary_address_id = 'primary'`
    ),
    check(
      "app_mail_domain_claim_receipt_snapshot_check",
      sql`typeof(raw_address_snapshot) = 'text'
        and length(raw_address_snapshot) between 3 and 320
        and typeof(normalized_address_snapshot) = 'text'
        and length(normalized_address_snapshot) between 3 and 320
        and instr(raw_address_snapshot, '@') between 2
          and length(raw_address_snapshot) - 2
        and instr(substr(raw_address_snapshot,
          instr(raw_address_snapshot, '@') + 1), '@') = 0
        and instr(normalized_address_snapshot, '@') between 2
          and length(normalized_address_snapshot) - 2
        and instr(substr(normalized_address_snapshot,
          instr(normalized_address_snapshot, '@') + 1), '@') = 0`
    ),
    check(
      "app_mail_domain_claim_receipt_domain_check",
      sql`typeof(canonical_domain) = 'text'
        and canonical_domain = lower(canonical_domain)
        and canonical_domain not glob '*[^a-z0-9.-]*'
        and canonicalization_profile_id = 'mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1'
        and canonicalization_version = 1`
    ),
    check(
      "app_mail_domain_claim_receipt_source_check",
      sql`(source = 'fresh-bootstrap'
          and source_bootstrap_operation_id is not null
          and source_audit_event_id is not null)
        or (source = 'legacy-reconciliation' and (
          (source_bootstrap_operation_id is null
            and source_audit_event_id is null)
          or (source_bootstrap_operation_id is null
            and source_audit_event_id is not null)
          or (source_bootstrap_operation_id is not null
            and source_audit_event_id is not null)))`
    ),
    check(
      "app_mail_domain_claim_receipt_time_check",
      sql`typeof(effective_at) = 'integer'
        and effective_at between 0 and 9007199254740991`
    ),
    check(
      "app_mail_domain_claim_receipt_schema_check",
      sql`typeof(schema_version) = 'integer' and schema_version = 1`
    ),
    uniqueIndex("app_mail_domain_claim_receipt_address_idx").on(
      t.mailboxId,
      t.primaryAddressId
    ),
  ]
);

export const appOrganizationOwnerAssignmentReceipt = sqliteTable(
  "app_organization_owner_assignment_receipt",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => appOrganization.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => appMailbox.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    membershipId: text("membership_id")
      .notNull()
      .unique()
      .references(() => appOrganizationMember.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    assignedAt: integer("assigned_at").notNull(),
    source: text("source", {
      enum: ["legacy-cutover", "fresh-bootstrap"],
    }).notNull(),
    legacySubjectType: text("legacy_subject_type").notNull(),
    legacySubjectId: text("legacy_subject_id").notNull(),
    legacyRoleId: text("legacy_role_id").notNull(),
    legacyScopeType: text("legacy_scope_type").notNull(),
    legacyScopeIdPresent: integer("legacy_scope_id_present").notNull(),
    legacyScopeId: text("legacy_scope_id").notNull(),
    organizationSubjectType: text("organization_subject_type").notNull(),
    organizationSubjectId: text("organization_subject_id").notNull(),
    organizationRoleId: text("organization_role_id").notNull(),
    organizationScopeType: text("organization_scope_type").notNull(),
    organizationScopeIdPresent: integer(
      "organization_scope_id_present"
    ).notNull(),
    organizationScopeId: text("organization_scope_id").notNull(),
    sourceBootstrapOperationId: text(
      "source_bootstrap_operation_id"
    ).references(() => appMailboxAdministrationReceipt.operationId, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    sourceAuditEventId: text("source_audit_event_id").references(
      administrativeAuditEventIdReference,
      { onDelete: "restrict", onUpdate: "restrict" }
    ),
    schemaVersion: integer("schema_version").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [
        t.legacySubjectType,
        t.legacySubjectId,
        t.legacyRoleId,
        t.legacyScopeType,
        t.legacyScopeIdPresent,
        t.legacyScopeId,
      ],
      foreignColumns: [
        authRoleGrant.subjectType,
        authRoleGrant.subjectId,
        authRoleGrant.roleId,
        authRoleGrant.scopeType,
        authRoleGrant.scopeIdPresent,
        authRoleGrant.scopeId,
      ],
      name: "app_organization_owner_assignment_receipt_legacy_grant_fk",
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    foreignKey({
      columns: [
        t.organizationSubjectType,
        t.organizationSubjectId,
        t.organizationRoleId,
        t.organizationScopeType,
        t.organizationScopeIdPresent,
        t.organizationScopeId,
      ],
      foreignColumns: [
        authRoleGrant.subjectType,
        authRoleGrant.subjectId,
        authRoleGrant.roleId,
        authRoleGrant.scopeType,
        authRoleGrant.scopeIdPresent,
        authRoleGrant.scopeId,
      ],
      name: "app_organization_owner_assignment_receipt_organization_grant_fk",
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    check(
      "app_organization_owner_assignment_receipt_identity_check",
      sql`organization_id = 'legacy_default_v1'
        and mailbox_id = 'primary'
        and membership_id = 'legacy_default_v1_owner_v1'
        and user_id = legacy_subject_id
        and user_id = organization_subject_id`
    ),
    check(
      "app_organization_owner_assignment_receipt_time_check",
      sql`typeof(assigned_at) = 'integer'
        and assigned_at between 0 and 9007199254740991`
    ),
    check(
      "app_organization_owner_assignment_receipt_source_check",
      sql`(source = 'fresh-bootstrap'
          and source_bootstrap_operation_id is not null
          and source_audit_event_id is not null)
        or (source = 'legacy-cutover' and (
          (source_bootstrap_operation_id is null
            and source_audit_event_id is null)
          or (source_bootstrap_operation_id is null
            and source_audit_event_id is not null)
          or (source_bootstrap_operation_id is not null
            and source_audit_event_id is not null)))`
    ),
    check(
      "app_organization_owner_assignment_receipt_legacy_check",
      sql`legacy_subject_type = 'user'
        and legacy_role_id = 'owner'
        and legacy_scope_type = 'mailbox'
        and legacy_scope_id_present = 1
        and legacy_scope_id = 'primary'`
    ),
    check(
      "app_organization_owner_assignment_receipt_organization_grant_check",
      sql`organization_subject_type = 'user'
        and organization_role_id = 'organization.owner'
        and organization_scope_type = 'organization'
        and organization_scope_id_present = 1
        and organization_scope_id = 'legacy_default_v1'`
    ),
    check(
      "app_organization_owner_assignment_receipt_schema_check",
      sql`typeof(schema_version) = 'integer' and schema_version = 1`
    ),
  ]
);

export const appUserPreference = sqliteTable(
  "app_user_preference",
  {
    userId: text("user_id").notNull(),
    defaultMailboxId: text("default_mailbox_id").references(
      () => appMailbox.id,
      {
        onDelete: "set null",
      }
    ),
    settingsJson: text("settings_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    primaryKey({ name: "app_user_preference_pkey", columns: [t.userId] }),
    check(
      "app_user_preference_user_id_check",
      sql`length(user_id) between 1 and 128`
    ),
    check(
      "app_user_preference_settings_json_check",
      sql`length(settings_json) <= 65536
        and json_valid(settings_json)
        and json_type(settings_json) = 'object'`
    ),
    check("app_user_preference_created_at_check", sql`created_at >= 0`),
    check(
      "app_user_preference_updated_at_check",
      sql`updated_at >= created_at`
    ),
    check("app_user_preference_version_check", sql`version >= 1`),
  ]
);
