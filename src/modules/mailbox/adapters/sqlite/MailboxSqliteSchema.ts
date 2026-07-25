import { defineRelations, desc, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

// Drizzle cannot represent SQLite STRICT tables or message_label's WITHOUT ROWID option.

export const mailboxSchemaMigration = sqliteTable("mailbox_schema_migration", {
  version: integer("version").primaryKey(),
  appliedAt: text("applied_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

export const mailboxMetadata = sqliteTable(
  "mailbox_metadata",
  {
    singleton: integer("singleton").primaryKey(),
    mailboxId: text("mailbox_id").notNull().unique(),
  },
  (t) => [
    check("mailbox_metadata_singleton_check", sql`${t.singleton} = 1`),
    check(
      "mailbox_metadata_mailbox_id_check",
      sql`length(${t.mailboxId}) between 1 and 128 and ${t.mailboxId} = trim(${t.mailboxId})`
    ),
  ]
);

export const folder = sqliteTable(
  "folder",
  {
    id: text("id").primaryKey(),
    version: integer("version").notNull().default(1),
    deletedAt: integer("deleted_at"),
    name: text("name").notNull().default("Migrated folder"),
    kind: text("kind", {
      enum: [
        "inbox",
        "sent",
        "drafts",
        "scheduled",
        "archive",
        "spam",
        "trash",
        "custom",
      ],
    })
      .notNull()
      .default("custom"),
    createdAt: integer("created_at").notNull().default(0),
    updatedAt: integer("updated_at").notNull().default(0),
  },
  (t) => [
    check(
      "folder_id_check",
      sql`length(${t.id}) between 1 and 128 and ${t.id} = trim(${t.id})`
    ),
    check("folder_version_check", sql`${t.version} >= 1`),
    check(
      "folder_deleted_at_check",
      sql`${t.deletedAt} is null or ${t.deletedAt} >= 0`
    ),
    check(
      "folder_name_check",
      sql`length(${t.name}) between 1 and 200 and ${t.name} = trim(${t.name})`
    ),
    check(
      "folder_kind_check",
      sql`${t.kind} in ('inbox', 'sent', 'drafts', 'scheduled', 'archive', 'spam', 'trash', 'custom')`
    ),
    check("folder_created_at_check", sql`${t.createdAt} >= 0`),
    check("folder_updated_at_check", sql`${t.updatedAt} >= ${t.createdAt}`),
    index("folder_active_list_idx")
      .on(t.kind, sql`${t.name} collate nocase`, t.id)
      .where(sql`deleted_at is null`),
    index("folder_active_name_idx")
      .on(sql`${t.name} collate nocase`, t.id)
      .where(sql`deleted_at is null`),
  ]
);

export const message = sqliteTable(
  "message",
  {
    id: text("id").primaryKey(),
    folderId: text("folder_id")
      .notNull()
      .references(() => folder.id, {
        onUpdate: "cascade",
        onDelete: "restrict",
      }),
    version: integer("version").notNull().default(1),
    deletedAt: integer("deleted_at"),
    read: integer("read").notNull().default(0),
    threadId: text("thread_id").notNull().default("legacy"),
    direction: text("direction", { enum: ["inbound", "outbound"] })
      .notNull()
      .default("inbound"),
    outboundDeliveryId: text("outbound_delivery_id"),
    subject: text("subject").notNull().default(""),
    senderJson: text("sender_json"),
    replyToJson: text("reply_to_json"),
    recipientsJson: text("recipients_json").notNull().default("[]"),
    snippet: text("snippet").notNull().default(""),
    activityAt: integer("activity_at").notNull().default(0),
    starred: integer("starred").notNull().default(0),
    needsReply: integer("needs_reply").notNull().default(0),
    size: integer("size").notNull().default(0),
    rfcMessageId: text("rfc_message_id"),
    inReplyTo: text("in_reply_to"),
    referencesJson: text("references_json").notNull().default("[]"),
    toJson: text("to_json").notNull().default("[]"),
    ccJson: text("cc_json").notNull().default("[]"),
    bccJson: text("bcc_json").notNull().default("[]"),
    textBody: text("text_body"),
    htmlBody: text("html_body"),
    headerDate: integer("header_date"),
    receivedAt: integer("received_at"),
    scheduledAt: integer("scheduled_at"),
    acceptedAt: integer("accepted_at"),
    createdAt: integer("created_at").notNull().default(0),
    updatedAt: integer("updated_at").notNull().default(0),
  },
  (t) => [
    check(
      "message_id_check",
      sql`length(${t.id}) between 1 and 128 and ${t.id} = trim(${t.id})`
    ),
    check("message_version_check", sql`${t.version} >= 1`),
    check(
      "message_deleted_at_check",
      sql`${t.deletedAt} is null or ${t.deletedAt} >= 0`
    ),
    check("message_read_check", sql`${t.read} in (0, 1)`),
    check(
      "message_thread_id_check",
      sql`length(${t.threadId}) between 1 and 128 and ${t.threadId} = trim(${t.threadId})`
    ),
    check(
      "message_direction_check",
      sql`${t.direction} in ('inbound', 'outbound')`
    ),
    check("message_subject_check", sql`length(${t.subject}) <= 998`),
    check(
      "message_sender_json_check",
      sql`${t.senderJson} is null or json_valid(${t.senderJson})`
    ),
    check(
      "message_reply_to_json_check",
      sql`${t.replyToJson} is null or case when json_valid(${t.replyToJson}) then json_type(${t.replyToJson}) = 'array' and json_array_length(${t.replyToJson}) between 1 and 256 else 0 end`
    ),
    check(
      "message_recipients_json_check",
      sql`json_valid(${t.recipientsJson})`
    ),
    check("message_snippet_check", sql`length(${t.snippet}) <= 500`),
    check("message_activity_at_check", sql`${t.activityAt} >= 0`),
    check("message_starred_check", sql`${t.starred} in (0, 1)`),
    check("message_needs_reply_check", sql`${t.needsReply} in (0, 1)`),
    check("message_size_check", sql`${t.size} >= 0`),
    check(
      "message_references_json_check",
      sql`json_valid(${t.referencesJson})`
    ),
    check("message_to_json_check", sql`json_valid(${t.toJson})`),
    check("message_cc_json_check", sql`json_valid(${t.ccJson})`),
    check("message_bcc_json_check", sql`json_valid(${t.bccJson})`),
    check(
      "message_header_date_check",
      sql`${t.headerDate} is null or ${t.headerDate} >= 0`
    ),
    check(
      "message_received_at_check",
      sql`${t.receivedAt} is null or ${t.receivedAt} >= 0`
    ),
    check(
      "message_scheduled_at_check",
      sql`${t.scheduledAt} is null or ${t.scheduledAt} >= 0`
    ),
    check(
      "message_accepted_at_check",
      sql`${t.acceptedAt} is null or ${t.acceptedAt} >= 0`
    ),
    check("message_created_at_check", sql`${t.createdAt} >= 0`),
    check("message_updated_at_check", sql`${t.updatedAt} >= ${t.createdAt}`),
    index("message_folder_id_idx").on(t.folderId, t.id),
    index("message_folder_active_read_idx")
      .on(t.folderId, t.read, t.id)
      .where(sql`deleted_at is null`),
    index("message_active_activity_idx")
      .on(desc(t.activityAt), desc(t.id))
      .where(sql`deleted_at is null`),
    index("message_active_thread_idx")
      .on(t.threadId, t.activityAt, t.id)
      .where(sql`deleted_at is null`),
    index("message_rfc_message_id_idx")
      .on(t.rfcMessageId, t.id)
      .where(sql`rfc_message_id is not null`),
  ]
);

export const inboundProcessing = sqliteTable(
  "inbound_processing",
  {
    id: text("id").primaryKey(),
    status: text("status", {
      enum: [
        "received",
        "raw_stored",
        "parsing",
        "attachments_stored",
        "ready",
        "failed",
      ],
    }).notNull(),
    messageId: text("message_id")
      .unique()
      .references(() => message.id, {
        onUpdate: "cascade",
        onDelete: "restrict",
      }),
    asyncRuleJobId: text("async_rule_job_id").references(
      (): AnySQLiteColumn => asyncRuleJob.id,
      { onUpdate: "cascade", onDelete: "restrict" }
    ),
    requestKey: text("request_key").notNull(),
    failureCode: text("failure_code"),
    failureAt: integer("failure_at"),
    failureReplayable: integer("failure_replayable"),
    attemptCount: integer("attempt_count").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    check(
      "inbound_processing_id_check",
      sql`length(${t.id}) between 1 and 128 and ${t.id} = trim(${t.id})`
    ),
    check(
      "inbound_processing_status_check",
      sql`${t.status} in ('received', 'raw_stored', 'parsing', 'attachments_stored', 'ready', 'failed')`
    ),
    check(
      "inbound_processing_message_check",
      sql`(${t.status} = 'ready' and ${t.messageId} is not null) or (${t.status} <> 'ready' and ${t.messageId} is null)`
    ),
    check(
      "inbound_processing_failure_check",
      sql`(${t.status} = 'failed' and ${t.failureCode} is not null and ${t.failureAt} is not null and ${t.failureReplayable} is not null and ${t.failureReplayable} in (0, 1)) or (${t.status} <> 'failed' and ${t.failureCode} is null and ${t.failureAt} is null and ${t.failureReplayable} is null)`
    ),
    check(
      "inbound_processing_failure_code_check",
      sql`${t.failureCode} is null or ${t.failureCode} in ('malformed_message', 'message_too_large', 'unsupported_message', 'processing_failed')`
    ),
    check(
      "inbound_processing_failure_at_check",
      sql`${t.failureAt} is null or ${t.failureAt} >= 0`
    ),
    check(
      "inbound_processing_attempt_count_check",
      sql`${t.attemptCount} >= 0`
    ),
    check("inbound_processing_created_at_check", sql`${t.createdAt} >= 0`),
    check(
      "inbound_processing_updated_at_check",
      sql`${t.updatedAt} >= ${t.createdAt}`
    ),
    check("inbound_processing_version_check", sql`${t.version} >= 1`),
    check(
      "inbound_processing_async_rule_job_check",
      sql`${t.asyncRuleJobId} is null or ${t.status} = 'ready'`
    ),
    uniqueIndex("inbound_processing_async_rule_job_uidx")
      .on(t.asyncRuleJobId)
      .where(sql`async_rule_job_id is not null`),
  ]
);

export const attachment = sqliteTable(
  "attachment",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => message.id, {
        onUpdate: "cascade",
        onDelete: "restrict",
      }),
    version: integer("version").notNull().default(1),
    deletedAt: integer("deleted_at"),
    fileName: text("file_name").notNull().default("attachment"),
    mimeType: text("mime_type").notNull().default("application/octet-stream"),
    size: integer("size").notNull().default(0),
    contentId: text("content_id"),
    inboundIngestId: text("inbound_ingest_id").references(
      () => inboundProcessing.id,
      { onUpdate: "cascade", onDelete: "restrict" }
    ),
    sourceIndex: integer("source_index"),
    contentSha256: text("content_sha256"),
    draftAttachmentId: text("draft_attachment_id").references(
      () => draftAttachment.id,
      { onUpdate: "restrict", onDelete: "restrict" }
    ),
    disposition: text("disposition", { enum: ["attachment", "inline"] })
      .notNull()
      .default("attachment"),
  },
  (t) => [
    check(
      "attachment_id_check",
      sql`length(${t.id}) between 1 and 128 and ${t.id} = trim(${t.id})`
    ),
    check("attachment_version_check", sql`${t.version} >= 1`),
    check(
      "attachment_deleted_at_check",
      sql`${t.deletedAt} is null or ${t.deletedAt} >= 0`
    ),
    check(
      "attachment_file_name_check",
      sql`length(${t.fileName}) between 1 and 255`
    ),
    check(
      "attachment_mime_type_check",
      sql`length(${t.mimeType}) between 3 and 255`
    ),
    check("attachment_size_check", sql`${t.size} >= 0`),
    check(
      "attachment_inbound_source_check",
      sql`(${t.inboundIngestId} is null and ${t.sourceIndex} is null) or (${t.inboundIngestId} is not null and ${t.sourceIndex} is not null and ${t.sourceIndex} >= 0)`
    ),
    check(
      "attachment_draft_source_check",
      sql`(${t.draftAttachmentId} is null and ${t.contentSha256} is null) or (${t.draftAttachmentId} is not null and ${t.contentSha256} is not null and length(${t.contentSha256}) = 64 and ${t.contentSha256} not glob '*[^a-f0-9]*')`
    ),
    check(
      "attachment_source_exclusivity_check",
      sql`${t.inboundIngestId} is null or ${t.draftAttachmentId} is null`
    ),
    check(
      "attachment_disposition_check",
      sql`${t.disposition} in ('attachment', 'inline')`
    ),
    index("attachment_message_id_idx").on(t.messageId, t.id),
    uniqueIndex("attachment_inbound_source_uidx")
      .on(t.inboundIngestId, t.sourceIndex)
      .where(sql`inbound_ingest_id is not null`),
    index("attachment_draft_attachment_id_idx")
      .on(t.draftAttachmentId, t.id)
      .where(sql`draft_attachment_id is not null`),
  ]
);

export const draft = sqliteTable(
  "draft",
  {
    id: text("id").primaryKey(),
    version: integer("version").notNull().default(1),
    deletedAt: integer("deleted_at"),
    threadId: text("thread_id"),
    inReplyToMessageId: text("in_reply_to_message_id"),
    toJson: text("to_json").notNull().default("[]"),
    ccJson: text("cc_json").notNull().default("[]"),
    bccJson: text("bcc_json").notNull().default("[]"),
    subject: text("subject").notNull().default(""),
    textBody: text("text_body"),
    htmlBody: text("html_body"),
    attachmentIdsJson: text("attachment_ids_json").notNull().default("[]"),
    createdAt: integer("created_at").notNull().default(0),
    updatedAt: integer("updated_at").notNull().default(0),
  },
  (t) => [
    check(
      "draft_id_check",
      sql`length(${t.id}) between 1 and 128 and ${t.id} = trim(${t.id})`
    ),
    check("draft_version_check", sql`${t.version} >= 1`),
    check(
      "draft_deleted_at_check",
      sql`${t.deletedAt} is null or ${t.deletedAt} >= 0`
    ),
    check("draft_to_json_check", sql`json_valid(${t.toJson})`),
    check("draft_cc_json_check", sql`json_valid(${t.ccJson})`),
    check("draft_bcc_json_check", sql`json_valid(${t.bccJson})`),
    check("draft_subject_check", sql`length(${t.subject}) <= 998`),
    check(
      "draft_attachment_ids_json_check",
      sql`json_valid(${t.attachmentIdsJson})`
    ),
    check("draft_created_at_check", sql`${t.createdAt} >= 0`),
    check("draft_updated_at_check", sql`${t.updatedAt} >= ${t.createdAt}`),
    index("draft_active_updated_idx")
      .on(desc(t.updatedAt), desc(t.id))
      .where(sql`deleted_at is null`),
  ]
);

export const draftAttachment = sqliteTable(
  "draft_attachment",
  {
    id: text("id").primaryKey(),
    draftId: text("draft_id")
      .notNull()
      .references(() => draft.id, {
        onUpdate: "cascade",
        onDelete: "restrict",
      }),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    status: text("status", { enum: ["reserved", "stored"] })
      .notNull()
      .default("reserved"),
    contentSha256: text("content_sha256"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    storedAt: integer("stored_at"),
  },
  (t) => [
    check(
      "draft_attachment_id_check",
      sql`length(${t.id}) between 1 and 128 and ${t.id} = trim(${t.id})`
    ),
    check(
      "draft_attachment_file_name_check",
      sql`length(${t.fileName}) between 1 and 255 and ${t.fileName} = trim(${t.fileName})`
    ),
    check(
      "draft_attachment_mime_type_check",
      sql`length(${t.mimeType}) between 3 and 255`
    ),
    check("draft_attachment_size_check", sql`${t.size} between 1 and 10485760`),
    check(
      "draft_attachment_status_check",
      sql`${t.status} in ('reserved', 'stored')`
    ),
    check(
      "draft_attachment_sha256_check",
      sql`${t.contentSha256} is null or (length(${t.contentSha256}) = 64 and ${t.contentSha256} not glob '*[^a-f0-9]*')`
    ),
    check("draft_attachment_created_at_check", sql`${t.createdAt} >= 0`),
    check(
      "draft_attachment_expires_at_check",
      sql`${t.expiresAt} > ${t.createdAt}`
    ),
    check(
      "draft_attachment_stored_at_check",
      sql`${t.storedAt} is null or ${t.storedAt} >= ${t.createdAt}`
    ),
    check(
      "draft_attachment_storage_state_check",
      sql`(${t.status} = 'reserved' and ${t.contentSha256} is null and ${t.storedAt} is null) or (${t.status} = 'stored' and ${t.contentSha256} is not null and ${t.storedAt} is not null)`
    ),
    index("draft_attachment_draft_status_idx").on(
      t.draftId,
      t.status,
      t.expiresAt,
      t.id
    ),
  ]
);

export const filterRule = sqliteTable(
  "filter_rule",
  {
    id: text("id").primaryKey(),
    version: integer("version").notNull().default(1),
    deletedAt: integer("deleted_at"),
    name: text("name").notNull().default("Migrated rule"),
    enabled: integer("enabled").notNull().default(0),
    priority: integer("priority").notNull().default(0),
    conditionsJson: text("conditions_json")
      .notNull()
      .default(
        '{"match":"all","items":[{"_tag":"HasAttachment","value":false}]}'
      ),
    actionsJson: text("actions_json")
      .notNull()
      .default('[{"_tag":"SetRead","read":false}]'),
    stopProcessing: integer("stop_processing").notNull().default(0),
    createdAt: integer("created_at").notNull().default(0),
    updatedAt: integer("updated_at").notNull().default(0),
    aiInstruction: text("ai_instruction"),
  },
  (t) => [
    check(
      "filter_rule_id_check",
      sql`length(${t.id}) between 1 and 128 and ${t.id} = trim(${t.id})`
    ),
    check("filter_rule_version_check", sql`${t.version} >= 1`),
    check(
      "filter_rule_deleted_at_check",
      sql`${t.deletedAt} is null or ${t.deletedAt} >= 0`
    ),
    check(
      "filter_rule_name_check",
      sql`length(${t.name}) between 1 and 200 and ${t.name} = trim(${t.name})`
    ),
    check("filter_rule_enabled_check", sql`${t.enabled} in (0, 1)`),
    check(
      "filter_rule_priority_check",
      sql`${t.priority} between 0 and 1000000`
    ),
    check(
      "filter_rule_conditions_json_check",
      sql`json_valid(${t.conditionsJson}) and json_type(${t.conditionsJson}) = 'object'`
    ),
    check(
      "filter_rule_actions_json_check",
      sql`json_valid(${t.actionsJson}) and json_type(${t.actionsJson}) = 'array'`
    ),
    check(
      "filter_rule_stop_processing_check",
      sql`${t.stopProcessing} in (0, 1)`
    ),
    check("filter_rule_created_at_check", sql`${t.createdAt} >= 0`),
    check(
      "filter_rule_updated_at_check",
      sql`${t.updatedAt} >= ${t.createdAt}`
    ),
    check(
      "filter_rule_ai_instruction_check",
      sql`${t.aiInstruction} is null or (length(${t.aiInstruction}) between 1 and 2000 and ${t.aiInstruction} = trim(${t.aiInstruction}) and ${t.stopProcessing} = 0)`
    ),
    index("filter_rule_active_priority_idx")
      .on(t.priority, t.id)
      .where(sql`enabled = 1 and deleted_at is null`),
  ]
);

export const asyncRuleJob = sqliteTable(
  "async_rule_job",
  {
    id: text("id").primaryKey(),
    inboundIngestId: text("inbound_ingest_id")
      .notNull()
      .unique()
      .references(() => inboundProcessing.id, {
        onUpdate: "cascade",
        onDelete: "restrict",
      }),
    messageId: text("message_id")
      .notNull()
      .unique()
      .references(() => message.id, {
        onUpdate: "cascade",
        onDelete: "restrict",
      }),
    planJson: text("plan_json").notNull(),
    status: text("status", {
      enum: ["pending", "running", "completed", "failed"],
    })
      .notNull()
      .default("pending"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    check(
      "async_rule_job_id_check",
      sql`length(${t.id}) between 1 and 128 and ${t.id} = trim(${t.id})`
    ),
    check(
      "async_rule_job_plan_json_check",
      sql`json_valid(${t.planJson}) and json_type(${t.planJson}) = 'object'`
    ),
    check(
      "async_rule_job_status_check",
      sql`${t.status} in ('pending', 'running', 'completed', 'failed')`
    ),
    check("async_rule_job_created_at_check", sql`${t.createdAt} >= 0`),
    check(
      "async_rule_job_updated_at_check",
      sql`${t.updatedAt} >= ${t.createdAt}`
    ),
    check("async_rule_job_version_check", sql`${t.version} >= 1`),
    index("async_rule_job_status_updated_idx").on(t.status, t.updatedAt, t.id),
  ]
);

export const ruleEvaluation = sqliteTable(
  "rule_evaluation",
  {
    inboundIngestId: text("inbound_ingest_id")
      .primaryKey()
      .references(() => inboundProcessing.id, {
        onUpdate: "cascade",
        onDelete: "restrict",
      }),
    messageId: text("message_id")
      .notNull()
      .unique()
      .references(() => message.id, {
        onUpdate: "cascade",
        onDelete: "restrict",
      }),
    engineVersion: integer("engine_version").notNull(),
    stoppedByRuleId: text("stopped_by_rule_id").references(
      () => filterRule.id,
      { onUpdate: "cascade", onDelete: "restrict" }
    ),
    evaluatedAt: integer("evaluated_at").notNull(),
  },
  (t) => [
    check("rule_evaluation_engine_version_check", sql`${t.engineVersion} = 1`),
    check("rule_evaluation_evaluated_at_check", sql`${t.evaluatedAt} >= 0`),
  ]
);

export const ruleApplication = sqliteTable(
  "rule_application",
  {
    inboundIngestId: text("inbound_ingest_id")
      .notNull()
      .references(() => ruleEvaluation.inboundIngestId, {
        onUpdate: "cascade",
        onDelete: "restrict",
      }),
    messageId: text("message_id")
      .notNull()
      .references(() => message.id, {
        onUpdate: "cascade",
        onDelete: "restrict",
      }),
    ruleId: text("rule_id")
      .notNull()
      .references(() => filterRule.id, {
        onUpdate: "cascade",
        onDelete: "restrict",
      }),
    ruleVersion: integer("rule_version").notNull(),
    actionIndex: integer("action_index").notNull(),
    actionJson: text("action_json").notNull(),
    outcome: text("outcome", {
      enum: ["applied", "noop", "skipped_invalid_target"],
    }).notNull(),
    appliedAt: integer("applied_at").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.inboundIngestId, t.ruleId, t.ruleVersion, t.actionIndex],
    }),
    check("rule_application_rule_version_check", sql`${t.ruleVersion} >= 1`),
    check(
      "rule_application_action_index_check",
      sql`${t.actionIndex} between 0 and 19`
    ),
    check(
      "rule_application_action_json_check",
      sql`json_valid(${t.actionJson}) and json_type(${t.actionJson}) = 'object'`
    ),
    check(
      "rule_application_outcome_check",
      sql`${t.outcome} in ('applied', 'noop', 'skipped_invalid_target')`
    ),
    check("rule_application_applied_at_check", sql`${t.appliedAt} >= 0`),
    index("rule_application_rule_applied_idx").on(
      t.ruleId,
      t.appliedAt,
      t.messageId
    ),
  ]
);

export const label = sqliteTable(
  "label",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    version: integer("version").notNull().default(1),
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    check(
      "label_id_check",
      sql`length(${t.id}) between 1 and 128 and ${t.id} = trim(${t.id})`
    ),
    check(
      "label_name_check",
      sql`length(${t.name}) between 1 and 200 and ${t.name} = trim(${t.name})`
    ),
    check("label_created_at_check", sql`${t.createdAt} >= 0`),
    check("label_updated_at_check", sql`${t.updatedAt} >= ${t.createdAt}`),
    check("label_version_check", sql`${t.version} >= 1`),
    check(
      "label_deleted_at_check",
      sql`${t.deletedAt} is null or ${t.deletedAt} >= 0`
    ),
    index("label_active_name_idx")
      .on(sql`${t.name} collate nocase`, t.id)
      .where(sql`deleted_at is null`),
  ]
);

export const mailboxOperation = sqliteTable(
  "mailbox_operation",
  {
    operationId: text("operation_id").primaryKey(),
    operationKind: text("operation_kind").notNull(),
    requestKey: text("request_key").notNull(),
    resourceId: text("resource_id").notNull(),
    resultPayload: text("result_payload").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    check(
      "mailbox_operation_operation_id_check",
      sql`length(${t.operationId}) between 1 and 128 and ${t.operationId} = trim(${t.operationId})`
    ),
    check(
      "mailbox_operation_operation_kind_check",
      sql`length(${t.operationKind}) between 1 and 128`
    ),
    check(
      "mailbox_operation_resource_id_check",
      sql`length(${t.resourceId}) between 1 and 128 and ${t.resourceId} = trim(${t.resourceId})`
    ),
    check("mailbox_operation_created_at_check", sql`${t.createdAt} >= 0`),
  ]
);

export const messageLabel = sqliteTable(
  "message_label",
  {
    messageId: text("message_id")
      .notNull()
      .references(() => message.id, {
        onUpdate: "cascade",
        onDelete: "cascade",
      }),
    labelId: text("label_id")
      .notNull()
      .references(() => label.id, {
        onUpdate: "cascade",
        onDelete: "restrict",
      }),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.labelId] }),
    index("message_label_label_idx").on(t.labelId, t.messageId),
  ]
);

export const outboundDelivery = sqliteTable(
  "outbound_delivery",
  {
    id: text("id").primaryKey(),
    resendOf: text("resend_of").references(
      (): AnySQLiteColumn => outboundDelivery.id,
      { onUpdate: "cascade", onDelete: "restrict" }
    ),
    messageId: text("message_id")
      .notNull()
      .unique()
      .references(() => message.id, {
        onUpdate: "cascade",
        onDelete: "restrict",
      }),
    status: text("status", {
      enum: [
        "scheduled",
        "sending",
        "accepted",
        "delivered",
        "bounced",
        "cancelled",
        "failed",
        "indeterminate",
      ],
    }).notNull(),
    sendAt: integer("send_at").notNull(),
    providerMessageId: text("provider_message_id"),
    acceptedAt: integer("accepted_at"),
    deliveredAt: integer("delivered_at"),
    bouncedAt: integer("bounced_at"),
    cancelledAt: integer("cancelled_at"),
    failureCode: text("failure_code"),
    failureAt: integer("failure_at"),
    attemptCount: integer("attempt_count").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    version: integer("version").notNull().default(1),
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    check(
      "outbound_delivery_id_check",
      sql`length(${t.id}) between 1 and 128 and ${t.id} = trim(${t.id})`
    ),
    check(
      "outbound_delivery_status_check",
      sql`${t.status} in ('scheduled', 'sending', 'accepted', 'delivered', 'bounced', 'cancelled', 'failed', 'indeterminate')`
    ),
    check("outbound_delivery_send_at_check", sql`${t.sendAt} >= 0`),
    check(
      "outbound_delivery_provider_message_id_check",
      sql`${t.providerMessageId} is null or (length(${t.providerMessageId}) between 1 and 998 and ${t.providerMessageId} = trim(${t.providerMessageId}))`
    ),
    check(
      "outbound_delivery_accepted_at_check",
      sql`${t.acceptedAt} is null or ${t.acceptedAt} >= 0`
    ),
    check(
      "outbound_delivery_delivered_at_check",
      sql`${t.deliveredAt} is null or ${t.deliveredAt} >= 0`
    ),
    check(
      "outbound_delivery_bounced_at_check",
      sql`${t.bouncedAt} is null or ${t.bouncedAt} >= 0`
    ),
    check(
      "outbound_delivery_cancelled_at_check",
      sql`${t.cancelledAt} is null or ${t.cancelledAt} >= 0`
    ),
    check(
      "outbound_delivery_failure_at_check",
      sql`${t.failureAt} is null or ${t.failureAt} >= 0`
    ),
    check("outbound_delivery_attempt_count_check", sql`${t.attemptCount} >= 0`),
    check("outbound_delivery_created_at_check", sql`${t.createdAt} >= 0`),
    check(
      "outbound_delivery_updated_at_check",
      sql`${t.updatedAt} >= ${t.createdAt}`
    ),
    check("outbound_delivery_version_check", sql`${t.version} >= 1`),
    check(
      "outbound_delivery_deleted_at_check",
      sql`${t.deletedAt} is null or ${t.deletedAt} >= 0`
    ),
    index("outbound_delivery_status_send_idx")
      .on(t.status, t.sendAt, t.id)
      .where(sql`deleted_at is null`),
  ]
);

export const mailboxSchema = {
  mailboxSchemaMigration,
  mailboxMetadata,
  folder,
  message,
  inboundProcessing,
  asyncRuleJob,
  attachment,
  draft,
  draftAttachment,
  filterRule,
  ruleEvaluation,
  ruleApplication,
  label,
  mailboxOperation,
  messageLabel,
  outboundDelivery,
};

export const mailboxRelations = defineRelations(mailboxSchema, (r) => ({
  folder: {
    messages: r.many.message({
      from: r.folder.id,
      to: r.message.folderId,
    }),
  },
  message: {
    folder: r.one.folder({
      from: r.message.folderId,
      to: r.folder.id,
      optional: false,
    }),
    attachments: r.many.attachment({
      from: r.message.id,
      to: r.attachment.messageId,
    }),
    inboundProcessing: r.one.inboundProcessing({
      from: r.message.id,
      to: r.inboundProcessing.messageId,
    }),
    messageLabels: r.many.messageLabel({
      from: r.message.id,
      to: r.messageLabel.messageId,
    }),
    labels: r.many.label({
      from: r.message.id.through(r.messageLabel.messageId),
      to: r.label.id.through(r.messageLabel.labelId),
    }),
    outboundDelivery: r.one.outboundDelivery({
      from: r.message.id,
      to: r.outboundDelivery.messageId,
    }),
    ruleEvaluation: r.one.ruleEvaluation({
      from: r.message.id,
      to: r.ruleEvaluation.messageId,
    }),
    ruleApplications: r.many.ruleApplication({
      from: r.message.id,
      to: r.ruleApplication.messageId,
    }),
  },
  inboundProcessing: {
    message: r.one.message({
      from: r.inboundProcessing.messageId,
      to: r.message.id,
    }),
    attachments: r.many.attachment({
      from: r.inboundProcessing.id,
      to: r.attachment.inboundIngestId,
    }),
    ruleEvaluation: r.one.ruleEvaluation({
      from: r.inboundProcessing.id,
      to: r.ruleEvaluation.inboundIngestId,
    }),
    asyncRuleJob: r.one.asyncRuleJob({
      from: r.inboundProcessing.asyncRuleJobId,
      to: r.asyncRuleJob.id,
    }),
  },
  attachment: {
    message: r.one.message({
      from: r.attachment.messageId,
      to: r.message.id,
      optional: false,
    }),
    inboundProcessing: r.one.inboundProcessing({
      from: r.attachment.inboundIngestId,
      to: r.inboundProcessing.id,
    }),
    draftAttachment: r.one.draftAttachment({
      from: r.attachment.draftAttachmentId,
      to: r.draftAttachment.id,
    }),
  },
  draft: {
    attachments: r.many.draftAttachment({
      from: r.draft.id,
      to: r.draftAttachment.draftId,
    }),
  },
  draftAttachment: {
    draft: r.one.draft({
      from: r.draftAttachment.draftId,
      to: r.draft.id,
      optional: false,
    }),
    messageAttachments: r.many.attachment({
      from: r.draftAttachment.id,
      to: r.attachment.draftAttachmentId,
    }),
  },
  asyncRuleJob: {
    inboundProcessing: r.one.inboundProcessing({
      from: r.asyncRuleJob.inboundIngestId,
      to: r.inboundProcessing.id,
      optional: false,
    }),
    message: r.one.message({
      from: r.asyncRuleJob.messageId,
      to: r.message.id,
      optional: false,
    }),
  },
  label: {
    messageLabels: r.many.messageLabel({
      from: r.label.id,
      to: r.messageLabel.labelId,
    }),
    messages: r.many.message({
      from: r.label.id.through(r.messageLabel.labelId),
      to: r.message.id.through(r.messageLabel.messageId),
    }),
  },
  filterRule: {
    evaluationsStopped: r.many.ruleEvaluation({
      from: r.filterRule.id,
      to: r.ruleEvaluation.stoppedByRuleId,
    }),
    applications: r.many.ruleApplication({
      from: r.filterRule.id,
      to: r.ruleApplication.ruleId,
    }),
  },
  ruleEvaluation: {
    inboundProcessing: r.one.inboundProcessing({
      from: r.ruleEvaluation.inboundIngestId,
      to: r.inboundProcessing.id,
      optional: false,
    }),
    message: r.one.message({
      from: r.ruleEvaluation.messageId,
      to: r.message.id,
      optional: false,
    }),
    stoppedByRule: r.one.filterRule({
      from: r.ruleEvaluation.stoppedByRuleId,
      to: r.filterRule.id,
    }),
    applications: r.many.ruleApplication({
      from: r.ruleEvaluation.inboundIngestId,
      to: r.ruleApplication.inboundIngestId,
    }),
  },
  ruleApplication: {
    evaluation: r.one.ruleEvaluation({
      from: r.ruleApplication.inboundIngestId,
      to: r.ruleEvaluation.inboundIngestId,
      optional: false,
    }),
    message: r.one.message({
      from: r.ruleApplication.messageId,
      to: r.message.id,
      optional: false,
    }),
    rule: r.one.filterRule({
      from: r.ruleApplication.ruleId,
      to: r.filterRule.id,
      optional: false,
    }),
  },
  messageLabel: {
    message: r.one.message({
      from: r.messageLabel.messageId,
      to: r.message.id,
      optional: false,
    }),
    label: r.one.label({
      from: r.messageLabel.labelId,
      to: r.label.id,
      optional: false,
    }),
  },
  outboundDelivery: {
    message: r.one.message({
      from: r.outboundDelivery.messageId,
      to: r.message.id,
      optional: false,
    }),
    resendOfDelivery: r.one.outboundDelivery({
      from: r.outboundDelivery.resendOf,
      to: r.outboundDelivery.id,
      alias: "outbound_delivery_resend",
    }),
    resends: r.many.outboundDelivery({
      from: r.outboundDelivery.id,
      to: r.outboundDelivery.resendOf,
      alias: "outbound_delivery_resend",
    }),
  },
}));
