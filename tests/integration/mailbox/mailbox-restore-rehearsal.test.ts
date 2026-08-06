/* oxlint-disable unicorn/no-array-sort, unicorn/numeric-separators-style, vitest/max-expects, eslint/no-await-in-loop -- The comprehensive fixture verifies ordered partial failures and canonical sorting. */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  draftAttachmentCustomMetadata,
  draftAttachmentObjectKey,
} from "#/modules/mailbox/adapters/r2/DraftAttachmentR2Object";
import {
  InboundAttachmentBlobReaderR2Layer,
  InboundAttachmentR2ReadClient,
} from "#/modules/mailbox/adapters/r2/InboundAttachmentBlobReaderR2";
import {
  inboundAttachmentCustomMetadata,
  inboundAttachmentMetadataBytes,
  inboundAttachmentObjectKey,
} from "#/modules/mailbox/adapters/r2/InboundAttachmentR2Object";
import { InboundAttachmentStoreRuntimeSystemLayer } from "#/modules/mailbox/adapters/r2/InboundAttachmentStoreR2";
import {
  inboundRawMessageCustomMetadata,
  inboundRawMessageObjectKey,
} from "#/modules/mailbox/adapters/r2/InboundRawMessageR2Object";
import {
  InboundRawMessageR2Client,
  InboundRawMessageReaderR2Layer,
} from "#/modules/mailbox/adapters/r2/InboundRawMessageReaderR2";
import {
  OutboundDraftAttachmentBlobReaderR2Layer,
  OutboundDraftAttachmentR2ReadClient,
} from "#/modules/mailbox/adapters/r2/OutboundDraftAttachmentBlobReaderR2";
import {
  applyMailboxMigrations,
  mailboxSchemaVersion,
} from "#/modules/mailbox/adapters/sqlite/MailboxSqliteMigrations";
import {
  AsyncRuleJob,
  AsyncRulePlanV1,
} from "#/modules/mailbox/domain/MailboxAsyncRuleJob";
import {
  FolderSchema,
  LabelSchema,
} from "#/modules/mailbox/domain/MailboxDirectory";
import { DraftSchema } from "#/modules/mailbox/domain/MailboxDraft";
import { DraftAttachmentReservationSchema } from "#/modules/mailbox/domain/MailboxDraftAttachment";
import {
  InboundProcessingSchema,
  ParsedInboundAttachmentV1,
  ReadInboundRawMessageInput,
} from "#/modules/mailbox/domain/MailboxInbound";
import {
  AttachmentBlobLocation,
  AttachmentMetadata,
  MessageDetailSchema,
} from "#/modules/mailbox/domain/MailboxMessage";
import { OutboundDeliverySchema } from "#/modules/mailbox/domain/MailboxOutbound";
import {
  RuleAction,
  RuleApplication,
  RuleEvaluationRecord,
  RuleSchema,
} from "#/modules/mailbox/domain/MailboxRule";
import { InboundAttachmentBlobReader } from "#/modules/mailbox/ports/InboundAttachmentBlobReader";
import { InboundRawMessageReader } from "#/modules/mailbox/ports/InboundRawMessageReader";
import { OutboundDraftAttachmentLocation } from "#/modules/mailbox/ports/MailboxOutboundDispatchStore";
import { OutboundDraftAttachmentBlobReader } from "#/modules/mailbox/ports/OutboundDraftAttachmentBlobReader";

import {
  canonicalMailboxRows,
  canonicalMailboxSchema,
  captureLocalMailboxRestoreArchive,
  InMemoryRehearsalObjectDestination,
  LocalMailboxRestoreEvidence,
  restoreLocalMailboxArchive,
} from "../../support/mailbox-restore-rehearsal";
import type {
  LocalMailboxRestoreArchive,
  RehearsalObject,
  RehearsalSourceObject,
} from "../../support/mailbox-restore-rehearsal";

const mailboxId = "mailbox_safe_015_opaque";
const rawKey = inboundRawMessageObjectKey("ingest-ready");
const inboundAttachmentKey = inboundAttachmentObjectKey("ingest-ready", 0);
const draftAttachmentKey = draftAttachmentObjectKey("draft-att-stored");
const orphanKey = inboundAttachmentObjectKey("ingest-in-flight", 0);

const rawBytes = new TextEncoder().encode(
  "From: sender@example.test\r\nTo: owner@example.test\r\nSubject: SAFE-015 secret subject\r\nX-Rehearsal: exact\r\n\r\nSensitive raw MIME body.\r\n"
);
const inboundAttachmentBytes = Uint8Array.from([0, 1, 2, 3, 4, 250]);
const draftAttachmentBytes = new TextEncoder().encode(
  "draft and outbound immutable attachment bytes"
);
const orphanBytes = Uint8Array.from([99, 98, 97, 96]);
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const makeMigrationStorage = (database: DatabaseSync) => ({
  transactionSync: <A>(run: () => A) => {
    database.exec("BEGIN");
    try {
      const result = run();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  },
  sql: {
    exec: (query: string, ...bindings: (string | number | null)[]) => {
      const statement = database.prepare(query);
      const rows = /^\s*(?:SELECT|WITH|PRAGMA)/iu.test(query)
        ? statement.all(...bindings)
        : (statement.run(...bindings), []);
      return {
        one: () => {
          if (rows.length !== 1 || rows[0] === undefined) {
            throw new Error(`Expected one row, received ${rows.length}`);
          }
          return rows[0];
        },
        toArray: () => rows,
      };
    },
  },
});

const insertMessage = (
  database: DatabaseSync,
  input: {
    readonly deletedAt?: number;
    readonly direction: "inbound" | "outbound";
    readonly folderId: string;
    readonly id: string;
    readonly outboundDeliveryId?: string;
    readonly acceptedAt?: number;
    readonly replyToJson?: string;
    readonly scheduledAt?: number;
    readonly subject: string;
  }
) =>
  database
    .prepare(
      `INSERT INTO message (
        id, folder_id, version, deleted_at, read, thread_id, direction,
        outbound_delivery_id, subject, sender_json, reply_to_json, recipients_json, snippet,
        activity_at, starred, needs_reply, size, rfc_message_id, in_reply_to,
        references_json, to_json, cc_json, bcc_json, text_body, html_body,
        header_date, received_at, scheduled_at, accepted_at, created_at, updated_at
      ) VALUES (?, ?, 3, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 321, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.folderId,
      input.deletedAt ?? null,
      `thread-${input.id}`,
      input.direction,
      input.outboundDeliveryId ?? null,
      input.subject,
      '{"address":"sender@example.test","displayName":"Sender Name"}',
      input.replyToJson ?? null,
      '[{"address":"owner@example.test","displayName":"Mailbox Owner"}]',
      `Sensitive snippet for ${input.id}`,
      2_000,
      `<${input.id}@example.test>`,
      "<parent@example.test>",
      '["<root@example.test>","<parent@example.test>"]',
      '[{"address":"owner@example.test"}]',
      '[{"address":"copy@example.test"}]',
      '[{"address":"blind@example.test"}]',
      `Sensitive body for ${input.id}`,
      `<p>Sensitive HTML for ${input.id}</p>`,
      1_050,
      input.direction === "inbound" ? 1_100 : null,
      input.scheduledAt ?? null,
      input.acceptedAt ?? null,
      1_000,
      2_000
    );

const seedOutboundDeliveries = (database: DatabaseSync) => {
  const rows = [
    {
      id: "delivery-failed",
      status: "failed",
      messageId: "outbound-failed",
      sendAt: 1_100,
      failureCode: "retry_exhausted",
      failureAt: 1_150,
      attemptCount: 3,
      createdAt: 1_000,
      updatedAt: 1_200,
    },
    {
      id: "delivery-scheduled",
      resendOf: "delivery-failed",
      status: "scheduled",
      messageId: "outbound-scheduled",
      sendAt: 2_000,
      attemptCount: 0,
      createdAt: 1_300,
      updatedAt: 1_300,
    },
    {
      id: "delivery-sending",
      status: "sending",
      messageId: "outbound-sending",
      sendAt: 1_100,
      attemptCount: 1,
      createdAt: 1_000,
      updatedAt: 1_150,
    },
    {
      id: "delivery-accepted",
      status: "accepted",
      messageId: "outbound-accepted",
      sendAt: 1_100,
      providerMessageId: "provider-accepted",
      acceptedAt: 1_150,
      attemptCount: 1,
      createdAt: 1_000,
      updatedAt: 1_150,
    },
    {
      id: "delivery-delivered",
      status: "delivered",
      messageId: "outbound-delivered",
      sendAt: 1_100,
      providerMessageId: "provider-delivered",
      acceptedAt: 1_150,
      deliveredAt: 1_180,
      attemptCount: 1,
      createdAt: 1_000,
      updatedAt: 1_180,
    },
    {
      id: "delivery-bounced",
      status: "bounced",
      messageId: "outbound-bounced",
      sendAt: 1_100,
      providerMessageId: "provider-bounced",
      acceptedAt: 1_150,
      bouncedAt: 1_190,
      attemptCount: 1,
      createdAt: 1_000,
      updatedAt: 1_190,
    },
    {
      id: "delivery-cancelled",
      status: "cancelled",
      messageId: "outbound-cancelled",
      sendAt: 2_000,
      cancelledAt: 1_400,
      attemptCount: 0,
      createdAt: 1_000,
      updatedAt: 1_400,
    },
    {
      id: "delivery-indeterminate",
      status: "indeterminate",
      messageId: "outbound-indeterminate",
      sendAt: 1_100,
      attemptCount: 1,
      createdAt: 1_000,
      updatedAt: 1_160,
    },
  ] as const;

  const insert = database.prepare(
    `INSERT INTO outbound_delivery (
      id, resend_of, message_id, archive_recipient, status, send_at, provider_message_id,
      accepted_at, delivered_at, bounced_at, cancelled_at, failure_code,
      failure_at, attempt_count, created_at, updated_at, version, deleted_at
    ) VALUES (?, ?, ?, 'Private.Archive@example.net', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2, ?)`
  );
  for (const row of rows) {
    insert.run(
      row.id,
      "resendOf" in row ? row.resendOf : null,
      row.messageId,
      row.status,
      row.sendAt,
      "providerMessageId" in row ? row.providerMessageId : null,
      "acceptedAt" in row ? row.acceptedAt : null,
      "deliveredAt" in row ? row.deliveredAt : null,
      "bouncedAt" in row ? row.bouncedAt : null,
      "cancelledAt" in row ? row.cancelledAt : null,
      "failureCode" in row ? row.failureCode : null,
      "failureAt" in row ? row.failureAt : null,
      row.attemptCount,
      row.createdAt,
      row.updatedAt,
      null
    );
  }

  for (const row of database.prepare("SELECT * FROM outbound_delivery").all()) {
    Schema.decodeUnknownSync(OutboundDeliverySchema)({
      id: row.id,
      resendOf: row.resend_of ?? undefined,
      mailboxId,
      messageId: row.message_id,
      status: row.status,
      sendAt: row.send_at,
      providerMessageId: row.provider_message_id ?? undefined,
      acceptedAt: row.accepted_at ?? undefined,
      deliveredAt: row.delivered_at ?? undefined,
      bouncedAt: row.bounced_at ?? undefined,
      cancelledAt: row.cancelled_at ?? undefined,
      failure:
        row.failure_code === null
          ? undefined
          : { code: row.failure_code, failedAt: row.failure_at },
      attemptCount: row.attempt_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    });
  }
};

const seedMailbox = (database: DatabaseSync) => {
  database.exec("PRAGMA foreign_keys = ON");
  database
    .prepare(
      "INSERT INTO mailbox_metadata (singleton, mailbox_id) VALUES (1, ?)"
    )
    .run(mailboxId);
  database.exec(`
    INSERT INTO folder (id, version, deleted_at, name, kind, created_at, updated_at) VALUES
      ('inbox', 2, NULL, 'Inbox', 'inbox', 100, 200),
      ('sent', 2, NULL, 'Sent', 'sent', 100, 200),
      ('scheduled', 1, NULL, 'Scheduled', 'scheduled', 100, 200),
      ('custom-project', 4, NULL, 'Project Private', 'custom', 100, 300),
      ('custom-deleted', 3, 400, 'Old Private', 'custom', 100, 400);
  `);

  insertMessage(database, {
    direction: "inbound",
    folderId: "inbox",
    id: "inbound-active",
    replyToJson:
      '[{"address":"reply@example.test","displayName":"Restored Reply"}]',
    subject: "SAFE-015 searchable active secret",
  });
  insertMessage(database, {
    deletedAt: 2_500,
    direction: "inbound",
    folderId: "custom-deleted",
    id: "inbound-deleted",
    subject: "SAFE-015 deleted-only-token secret",
  });
  database.exec(`
    INSERT INTO message (
      id, folder_id, version, deleted_at, read, thread_id, direction,
      outbound_delivery_id, subject, sender_json, recipients_json, snippet,
      activity_at, starred, needs_reply, size, rfc_message_id, in_reply_to,
      references_json, to_json, cc_json, bcc_json, text_body, html_body,
      header_date, received_at, scheduled_at, accepted_at, created_at, updated_at
    ) VALUES (
      'inbound-zero-token', 'inbox', 1, NULL, 0, 'thread-zero-token', 'inbound',
      NULL, '', NULL, '[]', '', 2000, 0, 0, 0, NULL, NULL,
      '[]', '[]', '[]', '[]', NULL, NULL, NULL, 1100, NULL, NULL, 1000, 2000
    );
  `);
  for (const state of ["pending", "running", "completed", "failed"] as const) {
    insertMessage(database, {
      direction: "inbound",
      folderId: "inbox",
      id: `inbound-job-${state}`,
      subject: `Async ${state} private subject`,
    });
  }
  for (const status of [
    "failed",
    "scheduled",
    "sending",
    "accepted",
    "delivered",
    "bounced",
    "cancelled",
    "indeterminate",
  ] as const) {
    insertMessage(database, {
      direction: "outbound",
      folderId: status === "scheduled" ? "scheduled" : "sent",
      id: `outbound-${status}`,
      outboundDeliveryId: `delivery-${status}`,
      acceptedAt:
        status === "accepted" || status === "delivered" || status === "bounced"
          ? 1_150
          : undefined,
      scheduledAt:
        status === "scheduled" || status === "cancelled" ? 2_000 : 1_100,
      subject: `Outbound ${status} private subject`,
    });
  }

  database.exec(`
    INSERT INTO inbound_processing
      (id, status, message_id, request_key, attempt_count, created_at, updated_at, version)
      VALUES ('ingest-ready', 'ready', 'inbound-active', '{"request":" ready ","nonce":1}', 2, 1000, 2000, 3);
    INSERT INTO inbound_processing
      (id, status, request_key, failure_code, failure_at, failure_replayable, attempt_count, created_at, updated_at, version)
      VALUES ('ingest-failed', 'failed', 'exact-request-key:failed:01', 'processing_failed', 1700, 1, 4, 1000, 1800, 4);
    INSERT INTO inbound_processing
      (id, status, message_id, request_key, attempt_count, created_at, updated_at, version) VALUES
      ('ingest-job-pending', 'ready', 'inbound-job-pending', 'job-request-pending', 1, 1000, 2000, 1),
      ('ingest-job-running', 'ready', 'inbound-job-running', 'job-request-running', 2, 1000, 2000, 2),
      ('ingest-job-completed', 'ready', 'inbound-job-completed', 'job-request-completed', 3, 1000, 2000, 3),
      ('ingest-job-failed', 'ready', 'inbound-job-failed', 'job-request-failed', 4, 1000, 2000, 4);

    INSERT INTO draft
      (id, version, deleted_at, thread_id, in_reply_to_message_id, to_json, cc_json, bcc_json, subject, text_body, html_body, attachment_ids_json, created_at, updated_at) VALUES
      ('draft-active', 5, NULL, 'thread-draft', 'inbound-active', '[{"address":"draft-to@example.test"}]', '[]', '[]', 'Private draft subject', 'Private draft body', '<p>Private draft HTML</p>', '["draft-att-reserved","draft-att-stored","draft-att-expired"]', 1000, 2000),
      ('draft-deleted', 2, 2100, NULL, NULL, '[]', '[]', '[]', 'Deleted draft secret', NULL, NULL, '[]', 1000, 2100);
  `);

  database
    .prepare(
      `INSERT INTO draft_attachment
        (id, draft_id, file_name, mime_type, size, status, content_sha256, created_at, expires_at, stored_at)
       VALUES (?, 'draft-active', ?, 'application/pdf', ?, 'stored', ?, 1000, 5000, 1200)`
    )
    .run(
      "draft-att-stored",
      "private-outbound-contract.pdf",
      draftAttachmentBytes.byteLength,
      sha256(draftAttachmentBytes)
    );
  database.exec(`
    INSERT INTO draft_attachment
      (id, draft_id, file_name, mime_type, size, status, created_at, expires_at) VALUES
      ('draft-att-reserved', 'draft-active', 'reserved-secret.txt', 'text/plain', 10, 'reserved', 1000, 5000),
      ('draft-att-expired', 'draft-active', 'expired-secret.txt', 'text/plain', 12, 'reserved', 1000, 1100);

    INSERT INTO attachment
      (id, message_id, version, deleted_at, file_name, mime_type, size, content_id, disposition, inbound_ingest_id, source_index, content_sha256, draft_attachment_id) VALUES
      ('attachment-inbound', 'inbound-active', 2, NULL, 'private-inbound.bin', 'application/octet-stream', 6, '<inline-private>', 'inline', 'ingest-ready', 0, NULL, NULL),
      ('attachment-legacy', 'inbound-active', 1, 2300, 'legacy-secret.txt', 'text/plain', 17, NULL, 'attachment', NULL, NULL, NULL, NULL);
  `);
  database
    .prepare(
      `INSERT INTO attachment
        (id, message_id, version, file_name, mime_type, size, disposition, content_sha256, draft_attachment_id)
       VALUES ('attachment-outbound-snapshot', 'outbound-delivered', 3, ?, 'application/pdf', ?, 'attachment', ?, 'draft-att-stored')`
    )
    .run(
      "private-outbound-contract.pdf",
      draftAttachmentBytes.byteLength,
      sha256(draftAttachmentBytes)
    );

  database.exec(`
    INSERT INTO label (id, name, created_at, updated_at, version, deleted_at) VALUES
      ('label-active', 'Private Active Label', 100, 200, 2, NULL),
      ('label-deleted', 'Private Deleted Label', 100, 300, 3, 300);
    INSERT INTO message_label (message_id, label_id) VALUES
      ('inbound-active', 'label-active'),
      ('inbound-active', 'label-deleted'),
      ('inbound-deleted', 'label-active');

    INSERT INTO filter_rule
      (id, version, deleted_at, name, enabled, priority, conditions_json, actions_json, stop_processing, created_at, updated_at, ai_instruction) VALUES
      ('rule-active-ai', 4, NULL, 'AI private classifier', 1, 10, '{"match":"all","items":[{"_tag":"HasAttachment","value":true}]}', '[{"_tag":"SetRead","read":true}]', 0, 100, 400, 'Classify the private customer message'),
      ('rule-active-stop', 1, NULL, 'Stopping private rule', 1, 11, '{"match":"all","items":[{"_tag":"HasAttachment","value":true}]}', '[{"_tag":"SetRead","read":true},{"_tag":"SetStarred","starred":true},{"_tag":"MoveToFolder","folderId":"custom-project"}]', 1, 100, 400, NULL),
      ('rule-disabled', 2, NULL, 'Disabled private rule', 0, 20, '{"match":"all","items":[{"_tag":"HasAttachment","value":false}]}', '[{"_tag":"SetStarred","starred":true}]', 1, 100, 300, NULL),
      ('rule-deleted', 3, 500, 'Deleted private rule', 0, 30, '{"match":"all","items":[{"_tag":"HasAttachment","value":false}]}', '[{"_tag":"SetRead","read":false}]', 0, 100, 500, NULL);
    INSERT INTO rule_evaluation
      (inbound_ingest_id, message_id, engine_version, stopped_by_rule_id, evaluated_at)
      VALUES ('ingest-ready', 'inbound-active', 1, 'rule-active-stop', 2050);
    INSERT INTO rule_application
      (inbound_ingest_id, message_id, rule_id, rule_version, action_index, action_json, outcome, applied_at) VALUES
      ('ingest-ready', 'inbound-active', 'rule-active-stop', 1, 0, '{"_tag":"SetRead","read":true}', 'applied', 2010),
      ('ingest-ready', 'inbound-active', 'rule-active-stop', 1, 1, '{"_tag":"SetStarred","starred":true}', 'noop', 2020),
      ('ingest-ready', 'inbound-active', 'rule-active-stop', 1, 2, '{"_tag":"MoveToFolder","folderId":"custom-project"}', 'skipped_invalid_target', 2030);

    INSERT INTO async_rule_job
      (id, inbound_ingest_id, message_id, plan_json, status, created_at, updated_at, version) VALUES
      ('job-pending', 'ingest-job-pending', 'inbound-job-pending', '{"formatVersion":1,"baseMessageVersion":3,"candidates":[{"ruleId":"rule-active-ai","ruleVersion":4,"instruction":"Classify the private customer message","actions":[{"_tag":"SetRead","read":true}]}]}', 'pending', 1000, 1100, 1),
      ('job-running', 'ingest-job-running', 'inbound-job-running', '{"formatVersion":1,"baseMessageVersion":3,"candidates":[{"ruleId":"rule-active-ai","ruleVersion":4,"instruction":"Classify the private customer message","actions":[{"_tag":"SetRead","read":true}]}]}', 'running', 1000, 1200, 2),
      ('job-completed', 'ingest-job-completed', 'inbound-job-completed', '{"formatVersion":1,"baseMessageVersion":3,"candidates":[{"ruleId":"rule-active-ai","ruleVersion":4,"instruction":"Classify the private customer message","actions":[{"_tag":"SetRead","read":true}]}]}', 'completed', 1000, 1300, 3),
      ('job-failed', 'ingest-job-failed', 'inbound-job-failed', '{"formatVersion":1,"baseMessageVersion":3,"candidates":[{"ruleId":"rule-active-ai","ruleVersion":4,"instruction":"Classify the private customer message","actions":[{"_tag":"SetRead","read":true}]}]}', 'failed', 1000, 1400, 4);
    UPDATE inbound_processing SET async_rule_job_id = 'job-pending' WHERE id = 'ingest-job-pending';
    UPDATE inbound_processing SET async_rule_job_id = 'job-running' WHERE id = 'ingest-job-running';
    UPDATE inbound_processing SET async_rule_job_id = 'job-completed' WHERE id = 'ingest-job-completed';
    UPDATE inbound_processing SET async_rule_job_id = 'job-failed' WHERE id = 'ingest-job-failed';

    INSERT INTO mailbox_operation
      (operation_id, operation_kind, request_key, resource_id, result_payload, created_at) VALUES
      ('operation-1', 'draft.update', ' {"request":"exact", "spaces": true} ', 'draft-active', ' {"result":"exact", "version":5} ', 2200),
      ('operation-2', 'message.move', 'request-key:exact:02', 'inbound-active', '{"folderId":"custom-project","version":3}', 2300);
  `);

  seedOutboundDeliveries(database);
  validateSeededMailbox(database);
};

const validateSeededMessages = (database: DatabaseSync) => {
  for (const row of database.prepare("SELECT * FROM message").all()) {
    const attachments = database
      .prepare(
        `SELECT * FROM attachment
         WHERE message_id = ? AND deleted_at IS NULL
         ORDER BY id`
      )
      .all(row.id)
      .map((attachment) =>
        Schema.decodeUnknownSync(AttachmentMetadata)({
          contentId: attachment.content_id ?? undefined,
          disposition: attachment.disposition,
          fileName: attachment.file_name,
          id: attachment.id,
          messageId: attachment.message_id,
          mimeType: attachment.mime_type,
          size: attachment.size,
        })
      );
    const delivery =
      row.outbound_delivery_id === null
        ? undefined
        : database
            .prepare(
              `SELECT status, accepted_at FROM outbound_delivery
               WHERE id = ? AND deleted_at IS NULL`
            )
            .get(row.outbound_delivery_id);
    const labelIds = database
      .prepare(
        `SELECT ml.label_id
         FROM message_label ml
         JOIN label l ON l.id = ml.label_id
         WHERE ml.message_id = ? AND l.deleted_at IS NULL
         ORDER BY ml.label_id`
      )
      .all(row.id)
      .map((label) => label.label_id);
    Schema.decodeUnknownSync(MessageDetailSchema)({
      acceptedAt: delivery?.accepted_at ?? undefined,
      activityAt: row.activity_at,
      attachments,
      bcc: JSON.parse(String(row.bcc_json)),
      cc: JSON.parse(String(row.cc_json)),
      deliveryStatus: delivery?.status,
      direction: row.direction,
      folderId: row.folder_id,
      hasAttachments: attachments.length > 0,
      headerDate: row.header_date ?? undefined,
      htmlBody: row.html_body ?? undefined,
      id: row.id,
      inReplyTo: row.in_reply_to ?? undefined,
      labelIds,
      mailboxId,
      outboundDeliveryId: row.outbound_delivery_id ?? undefined,
      read: row.read === 1,
      receivedAt: row.received_at ?? undefined,
      recipients: JSON.parse(String(row.recipients_json)),
      references: JSON.parse(String(row.references_json)),
      replyTo:
        row.reply_to_json === null
          ? undefined
          : JSON.parse(String(row.reply_to_json)),
      rfcMessageId: row.rfc_message_id ?? undefined,
      scheduledAt: row.scheduled_at ?? undefined,
      sender:
        row.sender_json === null
          ? undefined
          : JSON.parse(String(row.sender_json)),
      size: row.size,
      snippet: row.snippet,
      starred: row.starred === 1,
      subject: row.subject,
      textBody: row.text_body ?? undefined,
      threadId: row.thread_id,
      to: JSON.parse(String(row.to_json)),
      version: row.version,
    });
  }
};

const validateSeededMailbox = (database: DatabaseSync) => {
  for (const row of database.prepare("SELECT * FROM folder").all()) {
    Schema.decodeUnknownSync(FolderSchema)({
      createdAt: row.created_at,
      id: row.id,
      kind: row.kind,
      mailboxId,
      name: row.name,
      updatedAt: row.updated_at,
      version: row.version,
    });
  }
  for (const row of database.prepare("SELECT * FROM label").all()) {
    Schema.decodeUnknownSync(LabelSchema)({
      createdAt: row.created_at,
      id: row.id,
      mailboxId,
      name: row.name,
      updatedAt: row.updated_at,
      version: row.version,
    });
  }
  for (const row of database.prepare("SELECT * FROM draft").all()) {
    Schema.decodeUnknownSync(DraftSchema)({
      attachmentIds: JSON.parse(String(row.attachment_ids_json)),
      bcc: JSON.parse(String(row.bcc_json)),
      cc: JSON.parse(String(row.cc_json)),
      createdAt: row.created_at,
      htmlBody: row.html_body ?? undefined,
      id: row.id,
      inReplyToMessageId: row.in_reply_to_message_id ?? undefined,
      mailboxId,
      subject: row.subject,
      textBody: row.text_body ?? undefined,
      threadId: row.thread_id ?? undefined,
      to: JSON.parse(String(row.to_json)),
      updatedAt: row.updated_at,
      version: row.version,
    });
  }
  for (const row of database.prepare("SELECT * FROM draft_attachment").all()) {
    Schema.decodeUnknownSync(DraftAttachmentReservationSchema)({
      contentSha256: row.content_sha256 ?? undefined,
      createdAt: row.created_at,
      draftId: row.draft_id,
      expiresAt: row.expires_at,
      fileName: row.file_name,
      id: row.id,
      mailboxId,
      mimeType: row.mime_type,
      size: row.size,
      status: row.status,
      storedAt: row.stored_at ?? undefined,
    });
  }
  validateSeededMessages(database);
  validateSeededRuleRows(database);
  expect(database.prepare("PRAGMA foreign_key_check").all()).toStrictEqual([]);
};

const validateSeededRuleRows = (database: DatabaseSync) => {
  const ruleRows = database.prepare("SELECT * FROM filter_rule").all();
  for (const row of ruleRows) {
    Schema.decodeUnknownSync(RuleSchema)({
      actions: JSON.parse(String(row.actions_json)),
      aiInstruction: row.ai_instruction ?? undefined,
      conditions: JSON.parse(String(row.conditions_json)),
      createdAt: row.created_at,
      enabled: row.enabled === 1,
      id: row.id,
      mailboxId,
      name: row.name,
      priority: row.priority,
      stopProcessing: row.stop_processing === 1,
      updatedAt: row.updated_at,
      version: row.version,
    });
  }

  const processingRows = database
    .prepare("SELECT * FROM inbound_processing")
    .all();
  for (const row of processingRows) {
    Schema.decodeUnknownSync(InboundProcessingSchema)({
      asyncRuleJobId: row.async_rule_job_id ?? undefined,
      attemptCount: row.attempt_count,
      createdAt: row.created_at,
      failure:
        row.failure_code === null
          ? undefined
          : {
              code: row.failure_code,
              failedAt: row.failure_at,
              replayable: row.failure_replayable === 1,
            },
      id: row.id,
      mailboxId,
      messageId: row.message_id ?? undefined,
      status: row.status,
      updatedAt: row.updated_at,
      version: row.version,
    });
  }

  for (const row of database.prepare("SELECT * FROM async_rule_job").all()) {
    const plan = Schema.decodeUnknownSync(AsyncRulePlanV1)(
      JSON.parse(String(row.plan_json))
    );
    Schema.decodeUnknownSync(AsyncRuleJob)({
      createdAt: row.created_at,
      id: row.id,
      inboundIngestId: row.inbound_ingest_id,
      mailboxId,
      messageId: row.message_id,
      plan,
      status: row.status,
      updatedAt: row.updated_at,
      version: row.version,
    });
  }

  const evaluation = database.prepare("SELECT * FROM rule_evaluation").get();
  if (evaluation === undefined) {
    throw new Error("Expected seeded rule evaluation");
  }
  Schema.decodeUnknownSync(RuleEvaluationRecord)({
    evaluatedAt: evaluation.evaluated_at,
    inboundIngestId: evaluation.inbound_ingest_id,
    mailboxId,
    messageId: evaluation.message_id,
    engineVersion: evaluation.engine_version,
    stoppedByRuleId: evaluation.stopped_by_rule_id,
  });
  const stoppingRule = ruleRows.find(
    (row) => row.id === evaluation.stopped_by_rule_id
  );
  expect(stoppingRule).toMatchObject({
    deleted_at: null,
    enabled: 1,
    stop_processing: 1,
  });

  for (const row of database.prepare("SELECT * FROM rule_application").all()) {
    const action = Schema.decodeUnknownSync(RuleAction)(
      JSON.parse(String(row.action_json))
    );
    Schema.decodeUnknownSync(RuleApplication)({
      action,
      actionIndex: row.action_index,
      appliedAt: row.applied_at,
      inboundIngestId: row.inbound_ingest_id,
      mailboxId,
      messageId: row.message_id,
      outcome: row.outcome,
      ruleId: row.rule_id,
      ruleVersion: row.rule_version,
    });
    const rule = ruleRows.find((candidate) => candidate.id === row.rule_id);
    if (rule === undefined) {
      throw new Error("Rule application references a missing rule");
    }
    expect(rule).toMatchObject({
      deleted_at: null,
      enabled: 1,
      version: row.rule_version,
    });
    expect(
      JSON.parse(String(rule.actions_json))[Number(row.action_index)]
    ).toStrictEqual(action);
  }
};

const inboundIngestIds = [
  "ingest-failed",
  "ingest-job-completed",
  "ingest-job-failed",
  "ingest-job-pending",
  "ingest-job-running",
  "ingest-ready",
] as const;

const sourceObjects = (): ReadonlyMap<string, RehearsalSourceObject> => {
  const rawObjects = inboundIngestIds.map(
    (inboundIngestId) =>
      [
        inboundRawMessageObjectKey(inboundIngestId),
        {
          bytes: rawBytes,
          classification: "authoritative",
          objectType: "raw-message",
          customMetadata: inboundRawMessageCustomMetadata({
            envelopeFrom: "sender@example.test",
            envelopeTo: "owner@example.test",
            inboundIngestId,
            mailboxId,
            rawSize: rawBytes.byteLength,
            receivedAt: 1100,
          }),
          httpMetadata: { contentType: "message/rfc822" },
        },
      ] as const
  );
  const inboundMetadataSha256 = sha256(
    inboundAttachmentMetadataBytes(
      Schema.decodeUnknownSync(ParsedInboundAttachmentV1)({
        contentId: "<inline-private>",
        disposition: "inline",
        fileName: "private-inbound.bin",
        index: 0,
        mimeType: "application/octet-stream",
        size: 6,
      })
    )
  );
  const orphanMetadataSha256 = sha256(
    inboundAttachmentMetadataBytes(
      Schema.decodeUnknownSync(ParsedInboundAttachmentV1)({
        disposition: "attachment",
        fileName: "orphan-in-flight.bin",
        index: 0,
        mimeType: "application/octet-stream",
        size: orphanBytes.byteLength,
      })
    )
  );

  return new Map<string, RehearsalSourceObject>([
    ...rawObjects,
    [
      inboundAttachmentKey,
      {
        bytes: inboundAttachmentBytes,
        classification: "authoritative",
        objectType: "inbound-attachment",
        customMetadata: inboundAttachmentCustomMetadata({
          contentSha256: sha256(inboundAttachmentBytes),
          inboundIngestId: "ingest-ready",
          mailboxId,
          metadataSha256: inboundMetadataSha256,
          receivedAt: 1100,
          size: inboundAttachmentBytes.byteLength,
          sourceIndex: 0,
        }),
        httpMetadata: { contentType: "application/octet-stream" },
      },
    ],
    [
      draftAttachmentKey,
      {
        bytes: draftAttachmentBytes,
        classification: "authoritative",
        objectType: "draft-outbound-attachment",
        customMetadata: draftAttachmentCustomMetadata({
          attachmentId: "draft-att-stored",
          contentSha256: sha256(draftAttachmentBytes),
          draftId: "draft-active",
          expiresAt: 5000,
          mailboxId,
          size: draftAttachmentBytes.byteLength,
        }),
        httpMetadata: { contentType: "application/pdf" },
      },
    ],
    [
      orphanKey,
      {
        bytes: orphanBytes,
        classification: "mailbox-orphan-in-flight",
        objectType: "inbound-attachment",
        customMetadata: inboundAttachmentCustomMetadata({
          contentSha256: sha256(orphanBytes),
          inboundIngestId: "ingest-in-flight",
          mailboxId,
          metadataSha256: orphanMetadataSha256,
          receivedAt: 1150,
          size: orphanBytes.byteLength,
          sourceIndex: 0,
        }),
        httpMetadata: { contentType: "application/octet-stream" },
      },
    ],
  ]);
};

const generatedSnapshotInventory = (directory: string) =>
  readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && /^mailbox-restore-[\w-]+$/u.test(entry.name)
    )
    .map((entry) => entry.name)
    .sort();

const cloneArchive = (
  archive: LocalMailboxRestoreArchive
): LocalMailboxRestoreArchive => ({
  ...archive,
  manifest: archive.manifest,
  objects: new Map(
    [...archive.objects].map(([key, object]) => [
      key,
      {
        ...object,
        bytes: Uint8Array.from(object.bytes),
        customMetadata: { ...object.customMetadata },
        httpMetadata: { ...object.httpMetadata },
      },
    ])
  ),
});

const expectObjectMapsEqual = (
  restored: ReadonlyMap<string, RehearsalObject>,
  archived: ReadonlyMap<string, RehearsalSourceObject>
) => {
  expect([...restored.keys()].sort()).toStrictEqual(
    [...archived.keys()].sort()
  );
  for (const [key, expected] of archived) {
    const actual = restored.get(key);
    if (actual === undefined) {
      throw new Error(`Missing restored object ${key}`);
    }
    expect([...actual.bytes]).toStrictEqual([...expected.bytes]);
    expect(actual.customMetadata).toStrictEqual(expected.customMetadata);
    expect(actual.httpMetadata).toStrictEqual(expected.httpMetadata);
  }
};

const effectObject = (object: RehearsalObject) => ({
  arrayBuffer: () => Effect.succeed(Uint8Array.from(object.bytes).buffer),
  contentType: object.httpMetadata.contentType,
  customMetadata: object.customMetadata,
  sha256: object.customMetadata["content-sha256"],
  size: object.bytes.byteLength,
});

const verifyWithProductionReaders = async (
  objects: ReadonlyMap<string, RehearsalObject>
) => {
  const raw = await Effect.runPromise(
    InboundRawMessageReader.pipe(
      Effect.flatMap((reader) =>
        reader.read(
          Schema.decodeUnknownSync(ReadInboundRawMessageInput)({
            inboundIngestId: "ingest-ready",
            mailboxId,
            rawSize: rawBytes.byteLength,
            receivedAt: 1100,
          })
        )
      ),
      Effect.provide(
        InboundRawMessageReaderR2Layer.pipe(
          Layer.provide(
            Layer.succeed(
              InboundRawMessageR2Client,
              InboundRawMessageR2Client.of({
                get: (key) => {
                  const object = objects.get(key);
                  return Effect.succeed(
                    object === undefined ? null : effectObject(object)
                  );
                },
              })
            )
          )
        )
      )
    )
  );
  expect(new Uint8Array(raw)).toStrictEqual(rawBytes);

  const inbound = await Effect.runPromise(
    InboundAttachmentBlobReader.pipe(
      Effect.flatMap((reader) =>
        reader.read(
          Schema.decodeUnknownSync(AttachmentBlobLocation)({
            attachmentId: "attachment-inbound",
            contentId: "<inline-private>",
            disposition: "inline",
            fileName: "private-inbound.bin",
            folderId: "inbox",
            inboundIngestId: "ingest-ready",
            mailboxId,
            messageId: "inbound-active",
            mimeType: "application/octet-stream",
            receivedAt: 1100,
            size: inboundAttachmentBytes.byteLength,
            sourceIndex: 0,
          })
        )
      ),
      Effect.provide(
        InboundAttachmentBlobReaderR2Layer.pipe(
          Layer.provide(
            Layer.merge(
              Layer.succeed(
                InboundAttachmentR2ReadClient,
                InboundAttachmentR2ReadClient.of({
                  get: (key) => {
                    const object = objects.get(key);
                    return Effect.succeed(
                      object === undefined ? null : effectObject(object)
                    );
                  },
                })
              ),
              InboundAttachmentStoreRuntimeSystemLayer
            )
          )
        )
      )
    )
  );
  expect(inbound).toStrictEqual(inboundAttachmentBytes);

  const outbound = await Effect.runPromise(
    OutboundDraftAttachmentBlobReader.pipe(
      Effect.flatMap((reader) =>
        reader.read(
          Schema.decodeUnknownSync(OutboundDraftAttachmentLocation)({
            contentSha256: sha256(draftAttachmentBytes),
            draftAttachmentId: "draft-att-stored",
            mailboxId,
            mimeType: "application/pdf",
            size: draftAttachmentBytes.byteLength,
          })
        )
      ),
      Effect.provide(
        OutboundDraftAttachmentBlobReaderR2Layer.pipe(
          Layer.provide(
            Layer.succeed(
              OutboundDraftAttachmentR2ReadClient,
              OutboundDraftAttachmentR2ReadClient.of({
                get: (key) => {
                  const object = objects.get(key);
                  return Effect.succeed(
                    object === undefined ? null : effectObject(object)
                  );
                },
              })
            )
          )
        )
      )
    )
  );
  expect(outbound).toStrictEqual(draftAttachmentBytes);
};

const archiveWithManifest = (
  archive: LocalMailboxRestoreArchive,
  manifest: unknown
): LocalMailboxRestoreArchive => ({
  ...archive,
  manifest: manifest as LocalMailboxRestoreArchive["manifest"],
});

class FaultInjectingDestination extends InMemoryRehearsalObjectDestination {
  failAfterWrite: number | undefined;
  private readonly mutateAfterFirstWrite: (() => void) | undefined;
  private mutated = false;
  private writeCount = 0;

  constructor(failAfterWrite?: number, mutateAfterFirstWrite?: () => void) {
    super();
    this.failAfterWrite = failAfterWrite;
    this.mutateAfterFirstWrite = mutateAfterFirstWrite;
  }

  override async putIfAbsent(
    key: string,
    object: RehearsalObject
  ): Promise<"exists" | "written"> {
    const outcome = await super.putIfAbsent(key, object);
    if (outcome === "written") {
      this.writeCount += 1;
      if (!this.mutated && this.mutateAfterFirstWrite !== undefined) {
        this.mutated = true;
        this.mutateAfterFirstWrite();
      }
      if (this.writeCount === this.failAfterWrite) {
        throw new Error("injected destination write failure");
      }
    }
    return outcome;
  }
}

describe("SAFE-015 local mailbox logical/physical restore rehearsal", () => {
  let archive: LocalMailboxRestoreArchive;
  let directory: string;
  let source: DatabaseSync;
  let sourceOpen: boolean;

  beforeEach(async () => {
    directory = mkdtempSync(path.join(tmpdir(), "safe-015-restore-"));
    source = new DatabaseSync(path.join(directory, "source.sqlite"));
    sourceOpen = true;
    applyMailboxMigrations(makeMigrationStorage(source));
    seedMailbox(source);
    archive = await captureLocalMailboxRestoreArchive({
      archiveDirectory: directory,
      mailboxId,
      objects: sourceObjects(),
      snapshot: source,
    });
  });

  afterEach(() => {
    archive.close();
    if (sourceOpen) {
      source.close();
    }
    rmSync(directory, { force: true, recursive: true });
  });

  it("restores schema v15, every authoritative row, FTS, and exact blob state to the same mailbox", async () => {
    const targetPath = path.join(directory, "restored.sqlite");
    const destinationObjects = new InMemoryRehearsalObjectDestination();

    const evidence = await restoreLocalMailboxArchive({
      archive,
      destinationObjects,
      targetMailboxId: mailboxId,
      targetPath,
    });
    expect(evidence.restoreOutcome).toBe("restored");

    const restored = new DatabaseSync(targetPath);
    try {
      restored.exec("PRAGMA foreign_keys = ON");
      expect(canonicalMailboxRows(restored)).toStrictEqual(
        canonicalMailboxRows(source)
      );
      expect(canonicalMailboxSchema(restored)).toStrictEqual(
        canonicalMailboxSchema(source)
      );
      expect(
        restored
          .prepare("PRAGMA integrity_check")
          .all()
          .map((row) => ({ ...row }))
      ).toStrictEqual([{ integrity_check: "ok" }]);
      expect(restored.prepare("PRAGMA foreign_key_check").all()).toStrictEqual(
        []
      );
      expect(
        restored
          .prepare(
            "SELECT version FROM mailbox_schema_migration ORDER BY version"
          )
          .all()
          .map((row) => row.version)
      ).toStrictEqual(
        Array.from({ length: mailboxSchemaVersion }, (_, index) => index + 1)
      );
      expect(
        restored
          .prepare(
            `SELECT name FROM sqlite_schema
             WHERE type IN ('index', 'trigger') AND name NOT LIKE 'sqlite_%'
             ORDER BY name`
          )
          .all()
          .map((row) => row.name)
      ).toStrictEqual([
        "async_rule_job_status_updated_idx",
        "attachment_draft_attachment_id_idx",
        "attachment_inbound_source_uidx",
        "attachment_message_id_idx",
        "draft_active_updated_idx",
        "draft_attachment_draft_status_idx",
        "filter_rule_active_priority_idx",
        "folder_active_list_idx",
        "folder_active_name_idx",
        "inbound_processing_async_rule_job_uidx",
        "label_active_name_idx",
        "message_active_activity_idx",
        "message_active_thread_idx",
        "message_folder_active_read_idx",
        "message_folder_id_idx",
        "message_label_label_idx",
        "message_reply_to_json_insert_check",
        "message_reply_to_json_update_check",
        "message_rfc_message_id_idx",
        "message_search_ad",
        "message_search_ai",
        "message_search_au",
        "outbound_delivery_archive_recipient_immutable_replace",
        "outbound_delivery_archive_recipient_immutable_update",
        "outbound_delivery_archive_recipient_insert_check",
        "outbound_delivery_archive_recipient_update_check",
        "outbound_delivery_status_send_idx",
        "rule_application_rule_applied_idx",
      ]);

      const search = (term: string) =>
        restored
          .prepare(
            `SELECT id FROM message WHERE rowid IN (
              SELECT rowid FROM message_search WHERE message_search MATCH ?
            ) ORDER BY id`
          )
          .all(`"${term}"`)
          .map((row) => row.id);
      expect(search("searchable")).toStrictEqual(["inbound-active"]);
      expect(search("deleted-only-token")).toStrictEqual([]);
      restored.exec(
        "CREATE VIRTUAL TABLE temp.zero_token_vocab USING fts5vocab(main, message_search, 'instance')"
      );
      expect(
        restored
          .prepare(
            `SELECT doc FROM zero_token_vocab
             WHERE doc = (SELECT rowid FROM message WHERE id = 'inbound-zero-token')`
          )
          .all()
      ).toStrictEqual([]);

      const beforeIdempotentMigration = canonicalMailboxRows(restored);
      expect(applyMailboxMigrations(makeMigrationStorage(restored))).toBe(15);
      expect(canonicalMailboxRows(restored)).toStrictEqual(
        beforeIdempotentMigration
      );
      expect(
        restored
          .prepare(
            "SELECT id, reply_to_json FROM message WHERE id IN ('inbound-active', 'inbound-zero-token') ORDER BY id"
          )
          .all()
          .map((row) => ({ ...row }))
      ).toStrictEqual([
        {
          id: "inbound-active",
          reply_to_json:
            '[{"address":"reply@example.test","displayName":"Restored Reply"}]',
        },
        { id: "inbound-zero-token", reply_to_json: null },
      ]);
    } finally {
      restored.close();
    }

    expectObjectMapsEqual(destinationObjects.objects, archive.objects);
    await verifyWithProductionReaders(destinationObjects.objects);
    expect(archive.manifest.entries.map((entry) => entry.key)).toStrictEqual(
      [...archive.manifest.entries]
        .map((entry) => entry.key)
        .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    );
    expect(archive.manifest.entries).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classification: "mailbox-orphan-in-flight",
          key: orphanKey,
          objectType: "inbound-attachment",
        }),
      ])
    );

    const staleFts = new DatabaseSync(targetPath);
    try {
      staleFts.exec(
        "INSERT INTO message_search(message_search) VALUES('delete-all')"
      );
      expect(
        staleFts
          .prepare(
            "SELECT rowid FROM message_search WHERE message_search MATCH 'searchable'"
          )
          .all()
      ).toStrictEqual([]);
    } finally {
      staleFts.close();
    }

    const retry = await restoreLocalMailboxArchive({
      archive,
      destinationObjects,
      targetMailboxId: mailboxId,
      targetPath,
    });
    expect(retry.restoreOutcome).toBe("already-restored");
    expectObjectMapsEqual(destinationObjects.objects, archive.objects);
    const repairedFts = new DatabaseSync(targetPath, { readOnly: true });
    try {
      expect(
        repairedFts
          .prepare(
            `SELECT id FROM message WHERE rowid IN (
               SELECT rowid FROM message_search
               WHERE message_search MATCH 'searchable'
             )`
          )
          .all()
          .map((row) => row.id)
      ).toStrictEqual(["inbound-active"]);
    } finally {
      repairedFts.close();
    }
  });

  it("verifies an exact v13 archive, migrates it to v15, and preserves a null private archive snapshot", async () => {
    const v13Path = path.join(directory, "v13-source.sqlite");
    const v13Source = new DatabaseSync(v13Path);
    let v13Archive: LocalMailboxRestoreArchive | undefined;
    try {
      applyMailboxMigrations(makeMigrationStorage(v13Source));
      seedMailbox(v13Source);
      v13Source.exec(`
        DROP TRIGGER outbound_delivery_archive_recipient_immutable_replace;
        DROP TRIGGER outbound_delivery_archive_recipient_immutable_update;
        UPDATE outbound_delivery SET archive_recipient = NULL;
        DROP TRIGGER outbound_delivery_archive_recipient_insert_check;
        DROP TRIGGER outbound_delivery_archive_recipient_update_check;
        ALTER TABLE outbound_delivery DROP COLUMN archive_recipient;
        DELETE FROM mailbox_schema_migration WHERE version IN (14, 15);
      `);
      v13Archive = await captureLocalMailboxRestoreArchive({
        archiveDirectory: directory,
        mailboxId,
        objects: sourceObjects(),
        snapshot: v13Source,
      });
      expect(v13Archive.manifest.schemaVersion).toBe(13);

      const targetPath = path.join(directory, "restored-v13.sqlite");
      const destinationObjects = new InMemoryRehearsalObjectDestination();
      // Simulate publication succeeding while the caller loses the response.
      await restoreLocalMailboxArchive({
        archive: v13Archive,
        destinationObjects,
        targetMailboxId: mailboxId,
        targetPath,
      });
      const retryEvidence = await restoreLocalMailboxArchive({
        archive: v13Archive,
        destinationObjects,
        targetMailboxId: mailboxId,
        targetPath,
      });
      expect(retryEvidence).toMatchObject({
        restoreOutcome: "already-restored",
        schemaVersion: 15,
      });
      expect(
        Schema.decodeUnknownSync(LocalMailboxRestoreEvidence)({
          ...retryEvidence,
          schemaVersion: 13,
        }).schemaVersion
      ).toBe(13);

      const restored = new DatabaseSync(targetPath);
      try {
        expect(
          restored
            .prepare(
              "SELECT version FROM mailbox_schema_migration ORDER BY version"
            )
            .all()
            .map((row) => row.version)
        ).toStrictEqual(Array.from({ length: 15 }, (_, index) => index + 1));
        expect(
          restored
            .prepare(
              "SELECT mailbox_id FROM mailbox_metadata WHERE singleton = 1"
            )
            .get()?.mailbox_id
        ).toBe(mailboxId);
        expect(
          restored
            .prepare(
              "SELECT count(*) AS count FROM outbound_delivery WHERE archive_recipient IS NOT NULL"
            )
            .get()?.count
        ).toBe(0);
        expect(
          restored
            .prepare(
              "SELECT name FROM sqlite_schema WHERE type = 'trigger' AND name LIKE 'outbound_delivery_archive_recipient_%' ORDER BY name"
            )
            .all()
            .map((row) => row.name)
        ).toStrictEqual([
          "outbound_delivery_archive_recipient_immutable_replace",
          "outbound_delivery_archive_recipient_immutable_update",
          "outbound_delivery_archive_recipient_insert_check",
          "outbound_delivery_archive_recipient_update_check",
        ]);
        expect(applyMailboxMigrations(makeMigrationStorage(restored))).toBe(15);
        expect(restored.prepare("PRAGMA integrity_check").get()).toMatchObject({
          integrity_check: "ok",
        });
      } finally {
        restored.close();
      }

      const tampered = new DatabaseSync(targetPath);
      try {
        tampered
          .prepare(
            "UPDATE message SET subject = 'tampered after lost response' WHERE id = 'inbound-active'"
          )
          .run();
      } finally {
        tampered.close();
      }
      const tamperedBytes = readFileSync(targetPath);
      await expect(
        restoreLocalMailboxArchive({
          archive: v13Archive,
          destinationObjects,
          targetMailboxId: mailboxId,
          targetPath,
        })
      ).rejects.toThrow("Migrated SQLite snapshot changed");
      expect(readFileSync(targetPath)).toStrictEqual(tamperedBytes);
    } finally {
      v13Archive?.close();
      v13Source.close();
    }
  });

  it("migrates a v14 archive through the v15 accepted-message backfill", async () => {
    const v14Path = path.join(directory, "v14-source.sqlite");
    const v14Source = new DatabaseSync(v14Path);
    let v14Archive: LocalMailboxRestoreArchive | undefined;
    try {
      applyMailboxMigrations(makeMigrationStorage(v14Source));
      seedMailbox(v14Source);
      v14Source.exec(`
        UPDATE message
           SET folder_id = 'scheduled',
               scheduled_at = 1100,
               accepted_at = NULL,
               activity_at = 1000,
               updated_at = 1000,
               version = 3
         WHERE id = 'outbound-accepted';
        DELETE FROM mailbox_schema_migration WHERE version = 15;
      `);
      v14Archive = await captureLocalMailboxRestoreArchive({
        archiveDirectory: directory,
        mailboxId,
        objects: sourceObjects(),
        snapshot: v14Source,
      });
      expect(v14Archive.manifest.schemaVersion).toBe(14);

      const targetPath = path.join(directory, "restored-v14.sqlite");
      const destinationObjects = new InMemoryRehearsalObjectDestination();
      const evidence = await restoreLocalMailboxArchive({
        archive: v14Archive,
        destinationObjects,
        targetMailboxId: mailboxId,
        targetPath,
      });
      expect(evidence).toMatchObject({
        restoreOutcome: "restored",
        schemaVersion: 15,
      });

      const restored = new DatabaseSync(targetPath);
      try {
        expect({
          ...restored
            .prepare(
              `SELECT folder_id, scheduled_at, accepted_at, activity_at, updated_at, version
                   FROM message WHERE id = 'outbound-accepted'`
            )
            .get(),
        }).toStrictEqual({
          accepted_at: 1150,
          activity_at: 1150,
          folder_id: "sent",
          scheduled_at: null,
          updated_at: 1150,
          version: 4,
        });
        expect(
          restored
            .prepare(
              "SELECT archive_recipient FROM outbound_delivery WHERE id = 'delivery-accepted'"
            )
            .get()?.archive_recipient
        ).toBe("Private.Archive@example.net");
        expect(applyMailboxMigrations(makeMigrationStorage(restored))).toBe(15);
      } finally {
        restored.close();
      }

      const retryEvidence = await restoreLocalMailboxArchive({
        archive: v14Archive,
        destinationObjects,
        targetMailboxId: mailboxId,
        targetPath,
      });
      expect(retryEvidence.restoreOutcome).toBe("already-restored");
    } finally {
      v14Archive?.close();
      v14Source.close();
    }
  });

  it("rejects a different target mailbox before creating or publishing the target", async () => {
    const targetPath = path.join(directory, "wrong-mailbox.sqlite");
    const destinationObjects = new InMemoryRehearsalObjectDestination();

    await expect(
      restoreLocalMailboxArchive({
        archive,
        destinationObjects,
        targetMailboxId: "mailbox_other",
        targetPath,
      })
    ).rejects.toThrow("different mailbox ID");
    expect(existsSync(targetPath)).toBeFalsy();
    expect(destinationObjects.objects.size).toBe(0);
  });

  it("preflights an existing target before any destination object access", async () => {
    const targetPath = path.join(directory, "existing-wrong-mailbox.sqlite");
    const target = new DatabaseSync(targetPath);
    applyMailboxMigrations(makeMigrationStorage(target));
    target
      .prepare(
        "INSERT INTO mailbox_metadata (singleton, mailbox_id) VALUES (1, 'mailbox_other')"
      )
      .run();
    target.close();
    const targetBytes = readFileSync(targetPath);
    const sentinel = new Map<string, RehearsalObject>([
      [
        "foreign/sentinel",
        {
          bytes: Uint8Array.from([4, 2]),
          customMetadata: { owner: "foreign" },
          httpMetadata: { contentType: "application/foreign" },
        },
      ],
    ]);
    const destination = new InMemoryRehearsalObjectDestination(sentinel);

    await expect(
      restoreLocalMailboxArchive({
        archive,
        destinationObjects: destination,
        targetMailboxId: mailboxId,
        targetPath,
      })
    ).rejects.toThrow("SQLite snapshot does not match restore manifest");
    expect(readFileSync(targetPath)).toStrictEqual(targetBytes);
    expect([...sentinel.entries()]).toStrictEqual([
      [
        "foreign/sentinel",
        {
          bytes: Uint8Array.from([4, 2]),
          customMetadata: { owner: "foreign" },
          httpMetadata: { contentType: "application/foreign" },
        },
      ],
    ]);
  });

  it("rejects the archive snapshot itself as the restore target", async () => {
    const destination = new InMemoryRehearsalObjectDestination();

    await expect(
      restoreLocalMailboxArchive({
        archive,
        destinationObjects: destination,
        targetMailboxId: mailboxId,
        targetPath: archive.snapshotPath,
      })
    ).rejects.toThrow("cannot be the archive snapshot");
    expect(destination.objects.size).toBe(0);
  });

  it("restores the capture-time snapshot after the live source mutates and is deleted", async () => {
    const capturedRows = new DatabaseSync(archive.snapshotPath, {
      readOnly: true,
    });
    const expectedRows = canonicalMailboxRows(capturedRows);
    capturedRows.close();
    source.prepare("UPDATE folder SET name = 'Post-capture drift'").run();
    source.close();
    sourceOpen = false;
    rmSync(path.join(directory, "source.sqlite"), { force: true });

    const targetPath = path.join(directory, "capture-snapshot.sqlite");
    await restoreLocalMailboxArchive({
      archive,
      destinationObjects: new InMemoryRehearsalObjectDestination(),
      targetMailboxId: mailboxId,
      targetPath,
    });
    const restored = new DatabaseSync(targetPath, { readOnly: true });
    try {
      expect(canonicalMailboxRows(restored)).toStrictEqual(expectedRows);
    } finally {
      restored.close();
    }
  });

  it("removes a partial generated snapshot when SQLite backup throws", async () => {
    const before = generatedSnapshotInventory(directory);

    await expect(
      captureLocalMailboxRestoreArchive({
        archiveDirectory: directory,
        backupSqlite: (_database, destinationPath) => {
          writeFileSync(destinationPath, "partial backup");
          return Promise.reject(new Error("injected backup failure"));
        },
        mailboxId,
        objects: sourceObjects(),
        snapshot: source,
      })
    ).rejects.toThrow("injected backup failure");
    expect(generatedSnapshotInventory(directory)).toStrictEqual(before);

    let movedOwnedDirectory = "";
    let replacementDirectory = "";
    await expect(
      captureLocalMailboxRestoreArchive({
        archiveDirectory: directory,
        backupSqlite: (_database, destinationPath) => {
          writeFileSync(destinationPath, "partial owned backup");
          replacementDirectory = path.dirname(destinationPath);
          movedOwnedDirectory = `${replacementDirectory}-moved`;
          renameSync(replacementDirectory, movedOwnedDirectory);
          mkdirSync(replacementDirectory, { mode: 0o700 });
          writeFileSync(
            path.join(replacementDirectory, "foreign-marker"),
            "foreign replacement"
          );
          return Promise.reject(new Error("injected replacement failure"));
        },
        mailboxId,
        objects: sourceObjects(),
        snapshot: source,
      })
    ).rejects.toThrow("injected replacement failure");
    expect(
      readFileSync(path.join(replacementDirectory, "foreign-marker"), "utf-8")
    ).toBe("foreign replacement");
    expect(
      readFileSync(path.join(movedOwnedDirectory, "snapshot.sqlite"), "utf-8")
    ).toBe("partial owned backup");
    rmSync(replacementDirectory, { recursive: true });
    rmSync(movedOwnedDirectory, { recursive: true });
  });

  it("does not remove a foreign file that replaces the captured snapshot", () => {
    const ownedArchiveDirectory = path.dirname(archive.snapshotPath);
    const movedArchiveDirectory = path.join(directory, "owned-archive-moved");
    renameSync(ownedArchiveDirectory, movedArchiveDirectory);
    mkdirSync(ownedArchiveDirectory, { mode: 0o700 });
    writeFileSync(archive.snapshotPath, "foreign replacement");

    archive.close();

    expect(readFileSync(archive.snapshotPath, "utf-8")).toBe(
      "foreign replacement"
    );
    expect(
      existsSync(path.join(movedArchiveDirectory, "snapshot.sqlite"))
    ).toBeTruthy();
  });

  it("keeps unsafe integers only in the SQL canonicalizer edge case", async () => {
    const canonicalizerPath = path.join(directory, "canonicalizer-edge.sqlite");
    const canonicalizer = new DatabaseSync(canonicalizerPath);
    applyMailboxMigrations(makeMigrationStorage(canonicalizer));
    canonicalizer
      .prepare(
        "INSERT INTO mailbox_metadata (singleton, mailbox_id) VALUES (1, ?)"
      )
      .run(mailboxId);
    canonicalizer
      .prepare(
        `INSERT INTO mailbox_operation
          (operation_id, operation_kind, request_key, resource_id, result_payload, created_at)
         VALUES ('canonical-bigint', 'message.move', 'canonical-bigint',
                 'resource', '{}', ?)`
      )
      .run(9_007_199_254_740_993n);
    let canonicalArchive: LocalMailboxRestoreArchive | undefined;
    try {
      expect(
        canonicalMailboxRows(canonicalizer).mailbox_operation?.[0]?.created_at
      ).toBe(9_007_199_254_740_993n);
      canonicalArchive = await captureLocalMailboxRestoreArchive({
        archiveDirectory: directory,
        mailboxId,
        objects: new Map(),
        snapshot: canonicalizer,
      });
      expect(canonicalArchive.manifest.sqliteRowsSha256).toMatch(
        /^[a-f\d]{64}$/u
      );
    } finally {
      canonicalArchive?.close();
      canonicalizer.close();
    }
  });

  it("detects tampering of the archived SQLite snapshot instead of consulting the live source", async () => {
    const tampered = new DatabaseSync(archive.snapshotPath);
    tampered.prepare("UPDATE folder SET name = 'Archive tamper'").run();
    tampered.close();
    const targetPath = path.join(directory, "snapshot-tamper.sqlite");
    const destination = new InMemoryRehearsalObjectDestination();

    await expect(
      restoreLocalMailboxArchive({
        archive,
        destinationObjects: destination,
        targetMailboxId: mailboxId,
        targetPath,
      })
    ).rejects.toThrow("SQLite snapshot does not match restore manifest");
    expect(existsSync(targetPath)).toBeFalsy();
    expect(destination.objects.size).toBe(0);
  });

  it("derives required object closure from SQLite and rejects missing, foreign, or non-canonical objects", async () => {
    const cases = [
      {
        expected: "missing required raw object",
        mutate: (objects: Map<string, RehearsalSourceObject>) => {
          objects.delete(inboundRawMessageObjectKey("ingest-failed"));
        },
      },
      {
        expected: "missing required inbound attachment",
        mutate: (objects: Map<string, RehearsalSourceObject>) => {
          objects.delete(inboundAttachmentKey);
        },
      },
      {
        expected: "foreign mailbox object",
        mutate: (objects: Map<string, RehearsalSourceObject>) => {
          const object = objects.get(orphanKey);
          if (object === undefined) {
            throw new Error("Missing orphan fixture");
          }
          objects.set(orphanKey, {
            ...object,
            customMetadata: {
              ...object.customMetadata,
              "mailbox-id": "foreign-mailbox",
            },
          });
        },
      },
      {
        expected: "non-canonical attachment object",
        mutate: (objects: Map<string, RehearsalSourceObject>) => {
          const object = objects.get(orphanKey);
          if (object === undefined) {
            throw new Error("Missing orphan fixture");
          }
          objects.delete(orphanKey);
          objects.set("inbound/ingest-in-flight/attachments/wrong.bin", object);
        },
      },
      {
        expected: "inbound attachment size mismatch",
        mutate: (objects: Map<string, RehearsalSourceObject>) => {
          const object = objects.get(inboundAttachmentKey);
          if (object === undefined) {
            throw new Error("Missing inbound attachment fixture");
          }
          const bytes = Uint8Array.from([...object.bytes, 5]);
          objects.set(inboundAttachmentKey, {
            ...object,
            bytes,
            customMetadata: {
              ...object.customMetadata,
              "content-sha256": sha256(bytes),
            },
          });
        },
      },
      {
        expected: "draft attachment blob mismatch",
        mutate: (objects: Map<string, RehearsalSourceObject>) => {
          const object = objects.get(draftAttachmentKey);
          if (object === undefined) {
            throw new Error("Missing draft attachment fixture");
          }
          objects.set(draftAttachmentKey, {
            ...object,
            bytes: Uint8Array.from([...object.bytes, 0]),
          });
        },
      },
      {
        expected: "draft attachment blob mismatch",
        mutate: (objects: Map<string, RehearsalSourceObject>) => {
          const object = objects.get(draftAttachmentKey);
          if (object === undefined) {
            throw new Error("Missing draft attachment fixture");
          }
          objects.set(draftAttachmentKey, {
            ...object,
            bytes: Uint8Array.from(object.bytes, (byte, index) =>
              index === 0 ? (byte === 255 ? 254 : byte + 1) : byte
            ),
          });
        },
      },
      {
        expected: "object contract mismatch",
        mutate: (objects: Map<string, RehearsalSourceObject>) => {
          const object = objects.get(inboundAttachmentKey);
          if (object === undefined) {
            throw new Error("Missing inbound attachment fixture");
          }
          objects.set(inboundAttachmentKey, {
            ...object,
            customMetadata: {
              ...object.customMetadata,
              "attachment-size": "7",
            },
          });
        },
      },
    ];

    for (const testCase of cases) {
      const before = generatedSnapshotInventory(directory);
      const objects = new Map<string, RehearsalSourceObject>(sourceObjects());
      testCase.mutate(objects);
      await expect(
        captureLocalMailboxRestoreArchive({
          archiveDirectory: directory,
          mailboxId,
          objects,
          snapshot: source,
        })
      ).rejects.toThrow(testCase.expected);
      expect(generatedSnapshotInventory(directory)).toStrictEqual(before);
    }
  });

  it("rejects every outbound snapshot drift from its reservation and blob", async () => {
    const assertDrift = async (
      column: "content_sha256" | "mime_type" | "size",
      drift: number | string,
      original: number | string
    ) => {
      const before = generatedSnapshotInventory(directory);
      source
        .prepare(
          `UPDATE attachment SET ${column} = ? WHERE id = 'attachment-outbound-snapshot'`
        )
        .run(drift);
      try {
        await expect(
          captureLocalMailboxRestoreArchive({
            archiveDirectory: directory,
            mailboxId,
            objects: sourceObjects(),
            snapshot: source,
          })
        ).rejects.toThrow("outbound attachment snapshot mismatch");
        expect(generatedSnapshotInventory(directory)).toStrictEqual(before);
      } finally {
        source
          .prepare(
            `UPDATE attachment SET ${column} = ? WHERE id = 'attachment-outbound-snapshot'`
          )
          .run(original);
      }
    };

    await assertDrift(
      "size",
      draftAttachmentBytes.byteLength + 1,
      draftAttachmentBytes.byteLength
    );
    await assertDrift(
      "content_sha256",
      "0".repeat(64),
      sha256(draftAttachmentBytes)
    );
    await assertDrift(
      "mime_type",
      "application/x-sql-drift",
      "application/pdf"
    );
  });

  it("enforces a closed, unique, strictly sorted manifest and exact object key set", async () => {
    const entries = [...archive.manifest.entries];
    const manifests: readonly [unknown, string][] = [
      [
        { ...archive.manifest, entries: [entries[0], ...entries] },
        "unique and sorted",
      ],
      [
        {
          ...archive.manifest,
          entries: [...entries].sort((left, right) =>
            left.key < right.key ? 1 : left.key > right.key ? -1 : 0
          ),
        },
        "unique and sorted",
      ],
      [
        { ...archive.manifest, unexpected: "not-allowed" },
        "unknown or non-canonical fields",
      ],
      [
        { ...archive.manifest, overallSha256: "A".repeat(64) },
        "Expected a string matching",
      ],
      [
        { ...archive.manifest, mailboxIdSha256: "0".repeat(64) },
        "manifest digest mismatch",
      ],
    ];

    for (const [index, [manifest, expected]] of manifests.entries()) {
      await expect(
        restoreLocalMailboxArchive({
          archive: archiveWithManifest(archive, manifest),
          destinationObjects: new InMemoryRehearsalObjectDestination(),
          targetMailboxId: mailboxId,
          targetPath: path.join(directory, `manifest-${index}.sqlite`),
        })
      ).rejects.toThrow(expected);
    }

    const unmanifested = cloneArchive(archive);
    const orphan = unmanifested.objects.get(orphanKey);
    if (orphan === undefined) {
      throw new Error("Missing orphan fixture");
    }
    const secondOrphanKey = inboundAttachmentObjectKey("ingest-in-flight-2", 0);
    unmanifested.objects.set(secondOrphanKey, {
      ...orphan,
      customMetadata: {
        ...orphan.customMetadata,
        "inbound-ingest-id": "ingest-in-flight-2",
      },
    });
    await expect(
      restoreLocalMailboxArchive({
        archive: unmanifested,
        destinationObjects: new InMemoryRehearsalObjectDestination(),
        targetMailboxId: mailboxId,
        targetPath: path.join(directory, "unmanifested.sqlite"),
      })
    ).rejects.toThrow("missing or contains unmanifested objects");
  });

  it("leaves no target after each blob write failure and completes on an idempotent retry", async () => {
    for (
      let failAfterWrite = 1;
      failAfterWrite <= archive.manifest.entries.length;
      failAfterWrite += 1
    ) {
      const targetPath = path.join(
        directory,
        `partial-write-${failAfterWrite}.sqlite`
      );
      const destination = new FaultInjectingDestination(failAfterWrite);
      await expect(
        restoreLocalMailboxArchive({
          archive,
          destinationObjects: destination,
          targetMailboxId: mailboxId,
          targetPath,
        })
      ).rejects.toThrow("injected destination write failure");
      expect(existsSync(targetPath)).toBeFalsy();
      expect(destination.objects.size).toBe(failAfterWrite);

      destination.failAfterWrite = undefined;
      await expect(
        restoreLocalMailboxArchive({
          archive,
          destinationObjects: destination,
          targetMailboxId: mailboxId,
          targetPath,
        })
      ).resolves.toMatchObject({ restoreOutcome: "restored" });
      expectObjectMapsEqual(destination.objects, archive.objects);
    }

    const races = [
      {
        name: "deleted",
        mutate: (targetPath: string) => rmSync(targetPath),
        verify: (targetPath: string) =>
          expect(existsSync(targetPath)).toBeFalsy(),
      },
      {
        name: "replaced",
        mutate: (targetPath: string) => {
          renameSync(targetPath, `${targetPath}.owned`);
          writeFileSync(targetPath, "foreign replacement");
        },
        verify: (targetPath: string) =>
          expect(readFileSync(targetPath, "utf-8")).toBe("foreign replacement"),
      },
      {
        name: "modified",
        mutate: (targetPath: string) => {
          const changed = new DatabaseSync(targetPath);
          try {
            changed
              .prepare("UPDATE folder SET name = 'Concurrent modification'")
              .run();
          } finally {
            changed.close();
          }
        },
        verify: (targetPath: string) => {
          const changed = new DatabaseSync(targetPath, { readOnly: true });
          try {
            expect(
              changed
                .prepare("SELECT name FROM folder WHERE id = 'inbox'")
                .get()
            ).toMatchObject({ name: "Concurrent modification" });
          } finally {
            changed.close();
          }
        },
      },
    ] as const;

    for (const race of races) {
      const targetPath = path.join(directory, `existing-${race.name}.sqlite`);
      await restoreLocalMailboxArchive({
        archive,
        destinationObjects: new InMemoryRehearsalObjectDestination(),
        targetMailboxId: mailboxId,
        targetPath,
      });
      const destination = new FaultInjectingDestination(undefined, () =>
        race.mutate(targetPath)
      );
      await expect(
        restoreLocalMailboxArchive({
          archive,
          destinationObjects: destination,
          targetMailboxId: mailboxId,
          targetPath,
        })
      ).rejects.toThrow(
        race.name === "modified"
          ? "SQLite snapshot does not match restore manifest"
          : /destination SQLite (?:disappeared|identity changed)/u
      );
      expect(destination.objects.size).toBeGreaterThan(0);
      race.verify(targetPath);
    }
  });

  it("publishes SQLite no-clobber and never removes a concurrent target", async () => {
    const targetPath = path.join(directory, "concurrent.sqlite");
    await expect(
      restoreLocalMailboxArchive({
        archive,
        beforePublish: () => writeFileSync(targetPath, "concurrent-owner"),
        destinationObjects: new InMemoryRehearsalObjectDestination(),
        targetMailboxId: mailboxId,
        targetPath,
      })
    ).rejects.toThrow("appeared during publication");
    expect(readFileSync(targetPath, "utf-8")).toBe("concurrent-owner");

    const replacedTargetPath = path.join(directory, "replaced-staging.sqlite");
    let replacementStagingPath = "";
    await expect(
      restoreLocalMailboxArchive({
        archive,
        beforePublish: (stagingPath) => {
          replacementStagingPath = stagingPath;
          renameSync(stagingPath, `${stagingPath}.owned`);
          writeFileSync(stagingPath, "foreign staging replacement");
        },
        destinationObjects: new InMemoryRehearsalObjectDestination(),
        targetMailboxId: mailboxId,
        targetPath: replacedTargetPath,
      })
    ).rejects.toThrow("staged SQLite identity changed");
    expect(existsSync(replacedTargetPath)).toBeFalsy();
    expect(readFileSync(replacementStagingPath, "utf-8")).toBe(
      "foreign staging replacement"
    );
  });

  it("fails closed on same-size raw and attachment byte tampering or attachment metadata tampering", async () => {
    const cases = [
      {
        key: rawKey,
        mutate: (object: RehearsalSourceObject) => ({
          ...object,
          bytes: Uint8Array.from(object.bytes, (byte, index) =>
            index === 0 ? (byte === 255 ? 254 : byte + 1) : byte
          ),
        }),
      },
      {
        key: inboundAttachmentKey,
        mutate: (object: RehearsalSourceObject) => ({
          ...object,
          bytes: Uint8Array.from(object.bytes, (byte, index) =>
            index === object.bytes.length - 1
              ? byte === 255
                ? 254
                : byte + 1
              : byte
          ),
        }),
      },
      {
        key: inboundAttachmentKey,
        mutate: (object: RehearsalSourceObject) => ({
          ...object,
          customMetadata: {
            ...object.customMetadata,
            "attachment-size": "999",
          },
        }),
      },
      {
        key: inboundAttachmentKey,
        mutate: (object: RehearsalSourceObject) => ({
          ...object,
          httpMetadata: {
            ...object.httpMetadata,
            contentType: "application/x-tampered",
          },
        }),
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const tampered = cloneArchive(archive);
      const object = tampered.objects.get(testCase.key);
      if (object === undefined) {
        throw new Error(`Missing fixture object ${testCase.key}`);
      }
      tampered.objects.set(testCase.key, testCase.mutate(object));
      const targetPath = path.join(directory, `tampered-${index}.sqlite`);
      // oxlint-disable-next-line eslint/no-await-in-loop -- Cases reuse one open source snapshot and distinct target paths sequentially.
      await expect(
        restoreLocalMailboxArchive({
          archive: tampered,
          destinationObjects: new InMemoryRehearsalObjectDestination(),
          targetMailboxId: mailboxId,
          targetPath,
        })
      ).rejects.toThrow(/object (?:verification failed|contract mismatch)/u);
      expect(existsSync(targetPath)).toBeFalsy();
    }
  });

  it("rejects a missing or partial object archive before SQL publication", async () => {
    const partial = cloneArchive(archive);
    partial.objects.delete(draftAttachmentKey);
    const targetPath = path.join(directory, "partial.sqlite");

    await expect(
      restoreLocalMailboxArchive({
        archive: partial,
        destinationObjects: new InMemoryRehearsalObjectDestination(),
        targetMailboxId: mailboxId,
        targetPath,
      })
    ).rejects.toThrow("missing required object");
    expect(existsSync(targetPath)).toBeFalsy();
  });

  it("accepts identical destination objects and rejects drift without overwrite", async () => {
    const identicalDestination = new Map<string, RehearsalObject>(
      [...archive.objects].map(([key, object]) => [key, { ...object }])
    );
    const identicalAdapter = new InMemoryRehearsalObjectDestination(
      identicalDestination
    );
    await expect(
      restoreLocalMailboxArchive({
        archive,
        destinationObjects: identicalAdapter,
        targetMailboxId: mailboxId,
        targetPath: path.join(directory, "identical.sqlite"),
      })
    ).resolves.toMatchObject({ restoreOutcome: "restored" });
    expectObjectMapsEqual(identicalDestination, archive.objects);

    const driftBytes = Uint8Array.from([7, 7, 7]);
    const driftDestination = new Map<string, RehearsalObject>([
      [
        rawKey,
        {
          bytes: driftBytes,
          customMetadata: { drift: "must-survive" },
          httpMetadata: { contentType: "application/drift" },
        },
      ],
    ]);
    const driftAdapter = new InMemoryRehearsalObjectDestination(
      driftDestination
    );
    const driftTarget = path.join(directory, "object-drift.sqlite");
    await expect(
      restoreLocalMailboxArchive({
        archive,
        destinationObjects: driftAdapter,
        targetMailboxId: mailboxId,
        targetPath: driftTarget,
      })
    ).rejects.toThrow(`destination object drift at ${rawKey}`);
    expect(driftDestination.get(rawKey)).toStrictEqual({
      bytes: driftBytes,
      customMetadata: { drift: "must-survive" },
      httpMetadata: { contentType: "application/drift" },
    });
    expect(existsSync(driftTarget)).toBeFalsy();
  });

  it("emits only bounded sanitized local-rehearsal evidence", async () => {
    const evidence = await restoreLocalMailboxArchive({
      archive,
      destinationObjects: new InMemoryRehearsalObjectDestination(),
      targetMailboxId: mailboxId,
      targetPath: path.join(directory, "evidence.sqlite"),
    });
    expect(evidence).toStrictEqual({
      archiveObjectCount: 9,
      authoritativeRowCount: expect.any(Number),
      mailboxIdSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      manifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      mode: "local-rehearsal",
      orphanInFlightObjectCount: 1,
      restoreOutcome: "restored",
      schemaVersion: 15,
      sqliteRowsSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      limitations: {
        cloudflare: "not-exercised",
        durableObjectAlarm: "not-captured-requires-reconciliation",
        manifestIntegrity: "self-digest-not-authenticity",
        objectStorage: "in-memory-analog",
        workflowState: "not-captured-requires-reconciliation",
      },
    });

    const serialized = JSON.stringify(evidence);
    for (const sensitive of [
      "Private.Archive@example.net",
      "subject",
      "body",
      "example.test",
      "private-inbound.bin",
      "private-outbound-contract.pdf",
      "sensitive-meta-value",
      "customMetadata",
      "httpMetadata",
      mailboxId,
      rawKey,
    ]) {
      expect(serialized).not.toContain(sensitive);
    }
  });

  it("states alarm reconciliation and excludes Workflow state instead of claiming fake restore success", () => {
    expect(archive.manifest.mode).toBe("local-rehearsal");
    expect(archive.manifest.limitations).toStrictEqual({
      cloudflare: "not-exercised",
      durableObjectAlarm: "not-captured-requires-reconciliation",
      manifestIntegrity: "self-digest-not-authenticity",
      objectStorage: "in-memory-analog",
      workflowState: "not-captured-requires-reconciliation",
    });
    expect(JSON.stringify(archive.manifest)).not.toContain(
      "workflow-restore-succeeded"
    );
  });
});
