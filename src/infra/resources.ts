import * as Cloudflare from "alchemy/Cloudflare";

export const ControlPlaneDatabase = Cloudflare.D1.Database("ControlPlane", {
	migrationsDir: "./migrations/control-plane",
});

export const RawMessagesBucket = Cloudflare.R2.Bucket("RawMessages");
