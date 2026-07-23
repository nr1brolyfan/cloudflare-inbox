import * as Layer from "effect/Layer";

import { SensitiveOperationStepUpClockLive } from "#/auth/step-up-policy";
import { MailAuthorizationLive } from "#/authorization/mail-authorization";
import { MailResourceResolverLive } from "#/authorization/mail-resource-resolver-live";
import {
  MailboxAdministrationLive,
  MailboxAdministrationRuntimeLive,
} from "#/control-plane/mailbox-administration-live";
import { MailboxNavigationLive } from "#/control-plane/mailbox-navigation-live";
import { MailboxSenderIdentityLive } from "#/control-plane/mailbox-sender-identity-live";
import {
  AdministrativeAuditLayer,
  AdministrativeAuditRuntimeLayer,
} from "#/modules/administrative-audit/layers/AdministrativeAuditLayer";
import { MailboxDoClientLayer } from "#/modules/mailbox/adapters/durable-object/MailboxDoClient";
import { InboundReplayPreparerDoLayer } from "#/modules/mailbox/adapters/durable-object/MailboxInboundRepositoryDo";
import {
  MailboxDirectoryRepositoryDoLayer,
  MailboxDraftRepositoryDoLayer,
  MailboxMessageRepositoryDoLayer,
  MailboxOutboundDeliveryRepositoryDoLayer,
  MailboxOutboundSendingRepositoryDoLayer,
  MailboxResourceRepositoryDoLayer,
} from "#/modules/mailbox/adapters/durable-object/MailboxRepositoryDo";
import { MailboxHttpHandlersLayer } from "#/modules/mailbox/adapters/http/MailboxHttpHandlers";
import { DraftAttachmentBlobStoreR2Layer } from "#/modules/mailbox/adapters/r2/DraftAttachmentBlobStoreR2";
import { InboundAttachmentBlobReaderR2WithRuntimeLayer } from "#/modules/mailbox/adapters/r2/InboundAttachmentBlobReaderR2";
import { MailboxOutboundDeliveryReadingClockSystemLayer } from "#/modules/mailbox/adapters/system/MailboxOutboundDeliveryReadingClockSystem";
import { InboundWorkflowStarterCloudflareLayer } from "#/modules/mailbox/adapters/workflow/InboundWorkflowStarterCloudflare";
import { MailboxDraftAttachments } from "#/modules/mailbox/application/MailboxDraftAttachments";
import { MailboxDraftEditing } from "#/modules/mailbox/application/MailboxDraftEditing";
import { MailboxDraftReading } from "#/modules/mailbox/application/MailboxDraftReading";
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
import { MailboxRegistryD1Layer } from "#/modules/organization/adapters/d1/MailboxRegistryD1";

const MailboxDoClientWithRegistryLayer = MailboxDoClientLayer.pipe(
  Layer.provide(MailboxRegistryD1Layer)
);

const MailboxMessageRepositoryLayer = MailboxMessageRepositoryDoLayer.pipe(
  Layer.provide(MailboxDoClientWithRegistryLayer)
);
const MailboxDirectoryRepositoryLayer = MailboxDirectoryRepositoryDoLayer.pipe(
  Layer.provide(MailboxDoClientWithRegistryLayer)
);
const MailboxDraftRepositoryLayer = MailboxDraftRepositoryDoLayer.pipe(
  Layer.provide(MailboxDoClientWithRegistryLayer)
);
const MailboxOutboundDeliveryRepositoryLayer =
  MailboxOutboundDeliveryRepositoryDoLayer.pipe(
    Layer.provide(MailboxDoClientWithRegistryLayer)
  );
const MailboxOutboundSendingRepositoryLayer =
  MailboxOutboundSendingRepositoryDoLayer.pipe(
    Layer.provide(MailboxDoClientWithRegistryLayer)
  );
const MailboxResourceRepositoryLayer = MailboxResourceRepositoryDoLayer.pipe(
  Layer.provide(MailboxDoClientWithRegistryLayer)
);

const MailResourceResolverLayer = MailResourceResolverLive.pipe(
  Layer.provide(MailboxResourceRepositoryLayer)
);
const MailAuthorizationLayer = MailAuthorizationLive.pipe(
  Layer.provide(MailResourceResolverLayer)
);
const AdministrativeAuditWithRuntimeLayer = AdministrativeAuditLayer.pipe(
  Layer.provide(AdministrativeAuditRuntimeLayer)
);
const MailboxAdministrationLayer = MailboxAdministrationLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      AdministrativeAuditWithRuntimeLayer,
      MailboxAdministrationRuntimeLive,
      MailAuthorizationLayer,
      SensitiveOperationStepUpClockLive
    )
  )
);
const MailboxNavigationLayer = MailboxNavigationLive.pipe(
  Layer.provide(
    Layer.merge(MailAuthorizationLayer, MailboxDirectoryRepositoryLayer)
  )
);

const MailboxMessageReadingLayer = MailboxMessageReading.layerNoDeps.pipe(
  Layer.provide(
    Layer.merge(MailAuthorizationLayer, MailboxMessageRepositoryLayer)
  )
);
const MailboxMessageActionsLayer = MailboxMessageActions.layerNoDeps.pipe(
  Layer.provide(
    Layer.mergeAll(
      MailAuthorizationLayer,
      MailboxDirectoryRepositoryLayer,
      MailboxMessageRepositoryLayer
    )
  )
);
const MailboxDraftEditingLayer = MailboxDraftEditing.layerNoDeps.pipe(
  Layer.provide(
    Layer.merge(MailAuthorizationLayer, MailboxDraftRepositoryLayer)
  )
);
const MailboxDraftReadingLayer = MailboxDraftReading.layerNoDeps.pipe(
  Layer.provide(
    Layer.merge(MailAuthorizationLayer, MailboxDraftRepositoryLayer)
  )
);
const MailboxOutboundSendingLayer = MailboxOutboundSending.layerNoDeps.pipe(
  Layer.provide(
    Layer.mergeAll(
      MailAuthorizationLayer,
      MailboxOutboundSendingRepositoryLayer,
      MailboxSenderIdentityLive
    )
  )
);
const MailboxOutboundDeliveryReadingLayer =
  MailboxOutboundDeliveryReading.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        MailAuthorizationLayer,
        MailboxOutboundDeliveryRepositoryLayer,
        MailboxOutboundDeliveryReadingClockSystemLayer
      )
    )
  );
const MailboxDraftAttachmentsLayer = MailboxDraftAttachments.layerNoDeps.pipe(
  Layer.provide(
    Layer.mergeAll(
      MailAuthorizationLayer,
      MailboxDraftRepositoryLayer,
      DraftAttachmentBlobStoreR2Layer
    )
  )
);
const MailboxMessageHtmlLayer = MailboxMessageHtmlReading.layerNoDeps.pipe(
  Layer.provide(
    Layer.merge(MailAuthorizationLayer, MailboxMessageRepositoryLayer)
  )
);
const MailboxInlineAttachmentLayer =
  MailboxInlineAttachmentReading.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        MailAuthorizationLayer,
        MailboxMessageRepositoryLayer,
        InboundAttachmentBlobReaderR2WithRuntimeLayer
      )
    )
  );
const MailboxInboundReplayLayer = MailboxInboundReplay.layerNoDeps.pipe(
  Layer.provide(
    Layer.merge(
      InboundReplayPreparerDoLayer.pipe(Layer.provide(MailboxRegistryD1Layer)),
      InboundWorkflowStarterCloudflareLayer
    )
  )
);
const MailboxInboundReplayAuthorizationLayer =
  MailboxInboundReplayAuthorization.layerNoDeps.pipe(
    Layer.provide(MailAuthorizationLayer)
  );

/** Mailbox HTTP handlers with concrete mailbox and organization adapters selected. */
export const MailboxHttpLayer = MailboxHttpHandlersLayer.pipe(
  Layer.provide(
    Layer.mergeAll(
      MailboxAdministrationLayer,
      MailboxNavigationLayer,
      MailboxMessageReadingLayer,
      MailboxMessageActionsLayer,
      MailboxDraftEditingLayer,
      MailboxDraftReadingLayer,
      MailboxOutboundDeliveryReadingLayer,
      MailboxOutboundSendingLayer,
      MailboxDraftAttachmentsLayer,
      MailboxMessageHtmlLayer,
      MailboxInlineAttachmentLayer,
      MailboxInboundReplayAuthorizationLayer,
      MailboxInboundReplayLayer
    )
  )
);
