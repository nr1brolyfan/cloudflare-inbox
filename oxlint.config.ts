import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import tanstack from "ultracite/oxlint/tanstack";
import vitest from "ultracite/oxlint/vitest";

export default defineConfig({
  extends: [core, react, tanstack, vitest],
  ignorePatterns: [...(core.ignorePatterns ?? []), "migrations/**"],
  overrides: [
    {
      files: [
        "src/{modules,apps,platform,shared}/**/*.{ts,tsx}",
        "tests/{modules,apps,platform,shared}/**/*.{ts,tsx}",
      ],
      rules: {
        "unicorn/filename-case": "off",
      },
    },
    {
      files: ["scripts/**/*.ts"],
      rules: {
        "no-await-in-loop": "off",
      },
    },
  ],
  rules: {
    "func-names": "off",
    "func-style": "off",
    "no-nested-ternary": "off",
    "no-use-before-define": "off",
    "react/hook-use-state": "off",
    "sort-keys": "off",
    "unicorn/no-nested-ternary": "off",
  },
});
