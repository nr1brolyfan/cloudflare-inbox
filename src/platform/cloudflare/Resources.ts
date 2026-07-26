import * as Cloudflare from "alchemy/Cloudflare";

import { JobMailProductionTopology } from "#/platform/cloudflare/JobMailProductionTopology";

export const ControlPlaneDatabase = Cloudflare.D1.Database("ControlPlane", {
  migrationsDir: "./migrations/control-plane",
});

export const RawMessagesBucket = Cloudflare.R2.Bucket("RawMessages");

export const InboxAiGatewaySettings = {
  cacheInvalidateOnUpdate: false,
  cacheTtl: null,
  collectLogs: false,
  zdr: true,
} as const;

export const InboxAiGateway = Cloudflare.AI.Gateway(
  "InboxAiGateway",
  InboxAiGatewaySettings
);

export const AuthEmailSender = Cloudflare.Email.SendEmail("AuthEmail", {
  allowedSenderAddresses: JobMailProductionTopology.senders.auth,
});

export const MailboxEmailSender = Cloudflare.Email.SendEmail("MailboxEmail", {
  allowedSenderAddresses: JobMailProductionTopology.senders.mailbox,
});
