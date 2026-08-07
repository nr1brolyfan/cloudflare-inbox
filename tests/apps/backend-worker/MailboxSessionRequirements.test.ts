import { describe, expect, it } from "vitest";

import { MailboxGroup } from "#/apps/backend-worker/BackendMailboxHttpApi";
import {
  MailboxSessionRequirementsMatrix,
  MailboxSessionRequirementsMiddleware,
} from "#/apps/backend-worker/MailboxSessionRequirements";
import { SessionAuthenticationMiddleware } from "#/modules/account-security/contracts/RequestAuthMiddleware";
import { evaluateSessionRequirements } from "#/modules/account-security/domain/SessionRequirementsPolicy";

describe("mailbox session requirements matrix", () => {
  it("has the stable versioned identity and exact endpoint inventory", () => {
    const endpointKeys = Object.keys(MailboxGroup.endpoints);
    const matrixKeys = Object.keys(MailboxSessionRequirementsMatrix.operations);
    const expectedKeys = [
      "actOnMessage",
      "actOnMessages",
      "bootstrapOwner",
      "createDraft",
      "createReplyDraft",
      "getDraft",
      "getInboundAttachment",
      "getInlineAttachment",
      "getMessageHtml",
      "getNavigation",
      "getOutboundDelivery",
      "getThread",
      "listDrafts",
      "listMessages",
      "readOperation",
      "rename",
      "replayInbound",
      "reserveDraftAttachment",
      "sendDraft",
      "setThreadRead",
      "subscribeChanges",
      "undoSend",
      "updateDraft",
      "uploadDraftAttachment",
    ];
    // oxlint-disable-next-line unicorn/no-array-sort -- Stable order is needed only for set comparison.
    endpointKeys.sort();
    // oxlint-disable-next-line unicorn/no-array-sort -- Stable order is needed only for set comparison.
    matrixKeys.sort();
    // oxlint-disable-next-line unicorn/no-array-sort -- Stable order is needed only for set comparison.
    expectedKeys.sort();

    expect({
      endpointKeys,
      matrixId: MailboxSessionRequirementsMatrix.matrixId,
      matrixKeys,
      policyVersion: MailboxSessionRequirementsMatrix.policyVersion,
    }).toStrictEqual({
      endpointKeys: expectedKeys,
      matrixId: "mailbox-session-requirements",
      matrixKeys: expectedKeys,
      policyVersion: 1,
    });
  });

  it("defaults every current mailbox operation to unrestricted-only", () => {
    expect(
      Object.values(MailboxSessionRequirementsMatrix.operations).every(
        (policy) => policy.mode === "unrestricted-only"
      )
    ).toBeTruthy();
  });

  it("attaches neutral authentication and the matrix to every endpoint", () => {
    for (const endpoint of Object.values(MailboxGroup.endpoints)) {
      expect(
        endpoint.middlewares.has(SessionAuthenticationMiddleware)
      ).toBeTruthy();
      expect(
        endpoint.middlewares.has(MailboxSessionRequirementsMiddleware)
      ).toBeTruthy();
    }
  });

  it("denies an endpoint identifier absent from the mailbox matrix", () => {
    expect(
      evaluateSessionRequirements(
        MailboxSessionRequirementsMatrix,
        "futureMailboxOperation"
      )
    ).toStrictEqual({
      reason: "operation-not-declared",
      type: "denied",
    });
  });
});
