export const JOB_MAIL_PRODUCTION_STAGE = "production";

export const JobMailProductionTopology = {
  catchAll: {
    actions: [{ type: "drop" as const }],
    enabled: false,
    name: "Drop unmatched job mail",
  },
  routes: [
    {
      action: { type: "worker" as const },
      matcher: {
        field: "to" as const,
        type: "literal" as const,
        value: "szymon@szymondlugolecki.com",
      },
      name: "Inbound job mail",
    },
  ],
  routing: {
    enabled: true,
    zone: "szymondlugolecki.com",
  },
  senders: {
    auth: ["auth@szymondlugolecki.com"],
    mailbox: ["szymon@szymondlugolecki.com"],
  },
  website: {
    domain: "mail.szymondlugolecki.com",
  },
};

export const isJobMailProductionStage = (stage: string): boolean =>
  stage === JOB_MAIL_PRODUCTION_STAGE;

export const jobMailInboundRuleProps = <WorkerName>(
  workerName: WorkerName,
  enabled: boolean
) => {
  const [route] = JobMailProductionTopology.routes;
  return {
    actions: [{ type: route.action.type, value: [workerName] }],
    enabled,
    matchers: [route.matcher],
    name: route.name,
  };
};
