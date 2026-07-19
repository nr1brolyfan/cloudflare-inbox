import {
  PermissionAdministrationLive,
  PermissionsFromStoreLive,
} from "@effect-auth/core/Permission";
import * as Layer from "effect/Layer";

/** Permission administration and checks backed by the shared control-plane D1. */
export const MailPermissionsLive = Layer.merge(
  PermissionAdministrationLive,
  PermissionsFromStoreLive
);
