import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    ...(ultracite.ignorePatterns ?? []),
    "cloudflare-inbox.md",
    "migrations/**",
  ],
  sortTailwindcss: {
    functions: ["clsx", "cn", "cva"],
    stylesheet: "./src/styles.css",
  },
});
