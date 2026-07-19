import { createServerFn } from "@tanstack/react-start";

import { websiteBackend } from "./backend";

export type { DevEmailInboxResult } from "./backend";

export const getDevEmailInboxStatus = createServerFn({
  method: "GET",
}).handler(() => websiteBackend.getDevEmailInboxStatus());

export const listDevEmails = createServerFn({ method: "GET" }).handler(() =>
  websiteBackend.listDevEmails()
);

export const clearDevEmails = createServerFn({ method: "POST" }).handler(() =>
  websiteBackend.clearDevEmails()
);
