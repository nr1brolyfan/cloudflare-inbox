import { CoreAuthHttpApi, StepUpHttpApiGroup } from "@effect-auth/core/HttpApi";

/** Application auth contract added to the single BackendHttpApi. */
export const ApplicationAuthHttpApi = CoreAuthHttpApi.add(StepUpHttpApiGroup);
