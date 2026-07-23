import { AuthPolicyDeniedError } from "@effect-auth/core/HttpApi";
import { CurrentSession } from "@effect-auth/core/Sessions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpApiMiddleware from "effect/unstable/httpapi/HttpApiMiddleware";

import { evaluateSessionRequirements } from "#/modules/account-security/domain/SessionRequirementsPolicy";
import type { VersionedSessionRequirementsMatrix } from "#/modules/account-security/domain/SessionRequirementsPolicy";

export const MailboxOperation = {
  actOnMessage: "actOnMessage",
  bootstrapOwner: "bootstrapOwner",
  createDraft: "createDraft",
  getDraft: "getDraft",
  getInlineAttachment: "getInlineAttachment",
  getMessageHtml: "getMessageHtml",
  getNavigation: "getNavigation",
  getOutboundDelivery: "getOutboundDelivery",
  getThread: "getThread",
  listDrafts: "listDrafts",
  listMessages: "listMessages",
  readOperation: "readOperation",
  rename: "rename",
  replayInbound: "replayInbound",
  reserveDraftAttachment: "reserveDraftAttachment",
  sendDraft: "sendDraft",
  undoSend: "undoSend",
  updateDraft: "updateDraft",
  uploadDraftAttachment: "uploadDraftAttachment",
} as const;
export type MailboxOperation =
  (typeof MailboxOperation)[keyof typeof MailboxOperation];

export const MAILBOX_SESSION_REQUIREMENTS_MATRIX_ID =
  "mailbox-session-requirements";
export const MAILBOX_SESSION_REQUIREMENTS_POLICY_VERSION = 1;

const unrestrictedOnly = { mode: "unrestricted-only" } as const;

export const MailboxSessionRequirementsMatrix = {
  matrixId: MAILBOX_SESSION_REQUIREMENTS_MATRIX_ID,
  operations: {
    [MailboxOperation.actOnMessage]: unrestrictedOnly,
    [MailboxOperation.bootstrapOwner]: unrestrictedOnly,
    [MailboxOperation.createDraft]: unrestrictedOnly,
    [MailboxOperation.getDraft]: unrestrictedOnly,
    [MailboxOperation.getInlineAttachment]: unrestrictedOnly,
    [MailboxOperation.getMessageHtml]: unrestrictedOnly,
    [MailboxOperation.getNavigation]: unrestrictedOnly,
    [MailboxOperation.getOutboundDelivery]: unrestrictedOnly,
    [MailboxOperation.getThread]: unrestrictedOnly,
    [MailboxOperation.listDrafts]: unrestrictedOnly,
    [MailboxOperation.listMessages]: unrestrictedOnly,
    [MailboxOperation.readOperation]: unrestrictedOnly,
    [MailboxOperation.rename]: unrestrictedOnly,
    [MailboxOperation.replayInbound]: unrestrictedOnly,
    [MailboxOperation.reserveDraftAttachment]: unrestrictedOnly,
    [MailboxOperation.sendDraft]: unrestrictedOnly,
    [MailboxOperation.undoSend]: unrestrictedOnly,
    [MailboxOperation.updateDraft]: unrestrictedOnly,
    [MailboxOperation.uploadDraftAttachment]: unrestrictedOnly,
  },
  policyVersion: MAILBOX_SESSION_REQUIREMENTS_POLICY_VERSION,
} as const satisfies VersionedSessionRequirementsMatrix<
  MailboxOperation,
  typeof MAILBOX_SESSION_REQUIREMENTS_MATRIX_ID,
  typeof MAILBOX_SESSION_REQUIREMENTS_POLICY_VERSION
>;

export class MailboxSessionRequirementsMiddleware extends HttpApiMiddleware.Service<
  MailboxSessionRequirementsMiddleware,
  { requires: CurrentSession }
>()("cloudflare-inbox/MailboxSessionRequirementsMiddleware", {
  error: AuthPolicyDeniedError,
}) {}

export const MailboxSessionRequirementsMiddlewareLayer = Layer.succeed(
  MailboxSessionRequirementsMiddleware,
  (httpEffect, { endpoint }) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const decision = evaluateSessionRequirements(
        MailboxSessionRequirementsMatrix,
        endpoint.identifier,
        session.claims
      );
      if (decision.type === "denied") {
        return yield* new AuthPolicyDeniedError({
          code: "policy_denied",
          message: "Mailbox operation denied",
        });
      }
      return yield* httpEffect;
    })
);
