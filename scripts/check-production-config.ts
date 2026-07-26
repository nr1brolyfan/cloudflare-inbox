import path from "node:path";
import { pathToFileURL } from "node:url";

import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { jobMailProductionConfig } from "#/modules/organization/application/JobMailProductionConfig";

import {
  PRODUCTION_ENV_FILE,
  productionConfigProviderFromMap,
  readProductionEnvFile,
} from "./production-env";

export const validateProductionConfigFile = async (
  filePath = PRODUCTION_ENV_FILE
): Promise<boolean> => {
  try {
    const provider = productionConfigProviderFromMap(
      readProductionEnvFile(filePath)
    );
    const exit = await Effect.runPromiseExit(
      jobMailProductionConfig.pipe(
        Effect.provide(ConfigProvider.layer(provider))
      )
    );
    return Exit.isSuccess(exit);
  } catch {
    return false;
  }
};

const [, entrypoint] = process.argv;
if (
  entrypoint !== undefined &&
  pathToFileURL(path.resolve(entrypoint)).href === import.meta.url
) {
  if (await validateProductionConfigFile()) {
    console.log("production-config ok");
  } else {
    console.error("production-config failed");
    process.exitCode = 1;
  }
}
