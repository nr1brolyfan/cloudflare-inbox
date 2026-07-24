import path from "node:path";
import { pathToFileURL } from "node:url";

import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { mailDomainConfigPreflight } from "#/modules/organization/application/MailDomainConfigPreflight";

const mailDomainConfigExitMessage = (
  exit: Exit.Exit<
    { readonly profileId: string; readonly version: number },
    unknown
  >
): string =>
  Exit.isSuccess(exit)
    ? `mail-domain-config ok profile=${exit.value.profileId} version=${exit.value.version}`
    : "mail-domain-config failed";

const main = async (): Promise<void> => {
  const exit = await Effect.runPromiseExit(mailDomainConfigPreflight);
  const message = mailDomainConfigExitMessage(exit);
  if (Exit.isSuccess(exit)) {
    console.log(message);
  } else {
    console.error(message);
    process.exitCode = 1;
  }
};

const [, entrypoint] = process.argv;
if (
  entrypoint !== undefined &&
  pathToFileURL(path.resolve(entrypoint)).href === import.meta.url
) {
  await main();
}
