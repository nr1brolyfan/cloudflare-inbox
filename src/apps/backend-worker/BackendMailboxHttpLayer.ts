import * as Layer from "effect/Layer";

import { InboundReplayPreparerDoLayer } from "#/modules/mailbox/adapters/durable-object/MailboxInboundRepositoryDo";
import {
  MailboxDirectoryRepositoryDoLayer,
  MailboxDraftRepositoryDoLayer,
  MailboxReplyDraftRepositoryDoLayer,
  MailboxMessageRepositoryDoLayer,
  MailboxOutboundDeliveryRepositoryDoLayer,
  MailboxOutboundSendingRepositoryDoLayer,
} from "#/modules/mailbox/adapters/durable-object/MailboxRepositoryDo";
import { DraftAttachmentBlobStoreR2RuntimeLayer } from "#/modules/mailbox/adapters/r2/DraftAttachmentBlobStoreR2";
import { InboundAttachmentBlobReaderR2RuntimeLayer } from "#/modules/mailbox/adapters/r2/InboundAttachmentBlobReaderR2";
import { MailboxOutboundDeliveryReadingClockSystemLayer } from "#/modules/mailbox/adapters/system/MailboxOutboundDeliveryReadingClockSystem";
import { InboundWorkflowStarterCloudflareLayer } from "#/modules/mailbox/adapters/workflow/InboundWorkflowStarterCloudflare";
import { MailboxDraftAttachments } from "#/modules/mailbox/application/MailboxDraftAttachments";
import { MailboxDraftEditing } from "#/modules/mailbox/application/MailboxDraftEditing";
import { MailboxDraftReading } from "#/modules/mailbox/application/MailboxDraftReading";
import { MailboxInboundAttachmentReading } from "#/modules/mailbox/application/MailboxInboundAttachmentReading";
import {
  MailboxInboundReplay,
  MailboxInboundReplayAuthorization,
} from "#/modules/mailbox/application/MailboxInboundReplay";
import { MailboxInlineAttachmentReading } from "#/modules/mailbox/application/MailboxInlineAttachmentReading";
import { MailboxMessageActions } from "#/modules/mailbox/application/MailboxMessageActions";
import { MailboxMessageHtmlReading } from "#/modules/mailbox/application/MailboxMessageHtmlReading";
import { MailboxMessageReading } from "#/modules/mailbox/application/MailboxMessageReading";
import { MailboxOutboundDeliveryReading } from "#/modules/mailbox/application/MailboxOutboundDeliveryReading";
import { MailboxOutboundSending } from "#/modules/mailbox/application/MailboxOutboundSending";
import { MailboxReplyDraftCreation } from "#/modules/mailbox/application/MailboxReplyDraftCreation";

import { MailboxHttpHandlersLayer } from "./BackendMailboxHttpHandlers";
import { MailboxSessionRequirementsMiddlewareLayer } from "./MailboxSessionRequirements";

const MailboxMessageRepositoryLayer = MailboxMessageRepositoryDoLayer;
const MailboxDirectoryRepositoryLayer = MailboxDirectoryRepositoryDoLayer;
const MailboxDraftRepositoryLayer = MailboxDraftRepositoryDoLayer;
const MailboxOutboundDeliveryRepositoryLayer =
  MailboxOutboundDeliveryRepositoryDoLayer;
const MailboxOutboundSendingRepositoryLayer =
  MailboxOutboundSendingRepositoryDoLayer;

const MailboxMessageReadingLayer = MailboxMessageReading.layerNoDeps.pipe(
  Layer.provide(MailboxMessageRepositoryLayer)
);
const MailboxMessageActionsLayer = MailboxMessageActions.layerNoDeps.pipe(
  Layer.provide(
    Layer.mergeAll(
      MailboxDirectoryRepositoryLayer,
      MailboxMessageRepositoryLayer
    )
  )
);
const MailboxDraftEditingLayer = MailboxDraftEditing.layerNoDeps.pipe(
  Layer.provide(MailboxDraftRepositoryLayer)
);
const MailboxDraftReadingLayer = MailboxDraftReading.layerNoDeps.pipe(
  Layer.provide(MailboxDraftRepositoryLayer)
);
const MailboxReplyDraftCreationLayer =
  MailboxReplyDraftCreation.layerNoDeps.pipe(
    Layer.provide(MailboxReplyDraftRepositoryDoLayer)
  );
const MailboxOutboundSendingLayer = MailboxOutboundSending.layerNoDeps.pipe(
  Layer.provide(MailboxOutboundSendingRepositoryLayer)
);
const MailboxOutboundDeliveryReadingLayer =
  MailboxOutboundDeliveryReading.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        MailboxOutboundDeliveryRepositoryLayer,
        MailboxOutboundDeliveryReadingClockSystemLayer
      )
    )
  );
const MailboxDraftAttachmentsLayer = MailboxDraftAttachments.layerNoDeps.pipe(
  Layer.provide(
    Layer.mergeAll(
      MailboxDraftRepositoryLayer,
      DraftAttachmentBlobStoreR2RuntimeLayer
    )
  )
);
const MailboxMessageHtmlLayer = MailboxMessageHtmlReading.layerNoDeps.pipe(
  Layer.provide(MailboxMessageRepositoryLayer)
);
const MailboxInlineAttachmentLayer =
  MailboxInlineAttachmentReading.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        MailboxMessageRepositoryLayer,
        InboundAttachmentBlobReaderR2RuntimeLayer
      )
    )
  );
const MailboxInboundAttachmentLayer =
  MailboxInboundAttachmentReading.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        MailboxMessageRepositoryLayer,
        InboundAttachmentBlobReaderR2RuntimeLayer
      )
    )
  );
const MailboxInboundReplayLayer = MailboxInboundReplay.layerNoDeps.pipe(
  Layer.provide(
    Layer.merge(
      InboundReplayPreparerDoLayer,
      InboundWorkflowStarterCloudflareLayer
    )
  )
);
const MailboxInboundReplayAuthorizationLayer =
  MailboxInboundReplayAuthorization.layerNoDeps;

/** Mailbox HTTP handlers with only mailbox-owned adapters selected. */
export const MailboxHttpLayer = MailboxHttpHandlersLayer.pipe(
  Layer.provide(
    Layer.mergeAll(
      MailboxMessageReadingLayer,
      MailboxMessageActionsLayer,
      MailboxDraftEditingLayer,
      MailboxDraftReadingLayer,
      MailboxReplyDraftCreationLayer,
      MailboxOutboundDeliveryReadingLayer,
      MailboxOutboundSendingLayer,
      MailboxDraftAttachmentsLayer,
      MailboxMessageHtmlLayer,
      MailboxInlineAttachmentLayer,
      MailboxInboundAttachmentLayer,
      MailboxInboundReplayAuthorizationLayer,
      MailboxInboundReplayLayer,
      MailboxSessionRequirementsMiddlewareLayer
    )
  )
);
