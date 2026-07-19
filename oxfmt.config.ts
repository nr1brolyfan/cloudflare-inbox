import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    ...(ultracite.ignorePatterns ?? []),
    "cloudflare-inbox.md",
    "migrations/**",
    "src/auth/schema/**",
  ],
  sortTailwindcss: {
    stylesheet: "./src/styles.css",
  },
});
