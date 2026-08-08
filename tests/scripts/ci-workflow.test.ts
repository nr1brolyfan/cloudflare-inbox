import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflowSource = readFileSync(
  new URL("../../.github/workflows/ci.yml", import.meta.url),
  "utf-8"
);
const packageSource = readFileSync(
  new URL("../../package.json", import.meta.url),
  "utf-8"
);

const asRecord = (value: unknown, message: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${message}: expected a mapping`);
  }
  return value as Record<string, unknown>;
};

const asList = (value: unknown, message: string): unknown[] => {
  if (!Array.isArray(value)) {
    throw new TypeError(`${message}: expected a list`);
  }
  return value;
};

const isUnfilteredTrigger = (value: unknown): boolean =>
  value === null ||
  (typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length === 0);

const expressionMarker = "$";
const concurrencyGroup = `${expressionMarker}{{ github.workflow }}-${expressionMarker}{{ github.event.pull_request.number || github.ref }}`;
const workflow = asRecord(parse(workflowSource), "workflow");
// YAML 1.1 parsers may coerce the plain `on` key to boolean true.
const triggers = asRecord(workflow.on ?? workflow.true, "workflow on triggers");
const jobs = asRecord(workflow.jobs, "workflow jobs");
const job = asRecord(jobs.ci, "ci job");
const steps = asList(job.steps, "ci steps").map((step, index) =>
  asRecord(step, `ci step ${index + 1}`)
);
const actionSteps = steps.filter((step) => typeof step.uses === "string");

describe("CI workflow source contract", () => {
  it("runs on exactly pull requests, main pushes, and merge groups", () => {
    expect(new Set(Object.keys(triggers))).toStrictEqual(
      new Set(["merge_group", "pull_request", "push"])
    );
    expect(isUnfilteredTrigger(triggers.pull_request)).toBeTruthy();
    expect(isUnfilteredTrigger(triggers.merge_group)).toBeTruthy();
    expect(asRecord(triggers.push, "push trigger").branches).toStrictEqual([
      "main",
    ]);
  });

  it("uses minimal authority and cancels superseded runs", () => {
    expect(workflow.permissions).toStrictEqual({ contents: "read" });
    expect(job.permissions).toBeUndefined();
    expect(workflow.concurrency).toStrictEqual({
      "cancel-in-progress": true,
      group: concurrencyGroup,
    });
    expect(workflowSource).not.toMatch(/\bpull_request_target\b/u);
    expect(workflowSource).not.toMatch(/\bsecrets\b/iu);
  });

  it("defines one bounded Ubuntu status check", () => {
    expect(Object.keys(jobs)).toStrictEqual(["ci"]);
    expect(job["runs-on"]).toBe("ubuntu-24.04");
    expect(job["timeout-minutes"]).toBe(20);
  });

  it("pins audited actions and exact tool versions", () => {
    expect(actionSteps.map((step) => step.uses)).toStrictEqual([
      "actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955",
      "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
      "oven-sh/setup-bun@735343b667d3e6f658f44d0eca948eb6282f2b76",
    ]);
    expect(
      actionSteps.every((step) => /@[0-9a-f]{40}$/u.test(String(step.uses)))
    ).toBeTruthy();
    expect({
      bun: asRecord(actionSteps[2]?.with, "setup-bun inputs"),
      checkout: asRecord(actionSteps[0]?.with, "checkout inputs"),
      node: asRecord(actionSteps[1]?.with, "setup-node inputs"),
    }).toStrictEqual({
      bun: { "bun-version": "1.3.14", "no-cache": false },
      checkout: { "persist-credentials": false },
      node: { "node-version": "22.19.0" },
    });
  });

  it("installs inertly, patches trusted tooling, and runs separate gates", () => {
    const commands = steps
      .map((step) => step.run)
      .filter((command): command is string => typeof command === "string");
    expect(commands).toStrictEqual([
      "bun install --frozen-lockfile --ignore-scripts",
      "bun run prepare",
      "bun run check",
      "bun run typecheck",
      "bun run test",
      "bun run build",
    ]);

    const packageJson = asRecord(JSON.parse(packageSource), "package.json");
    const scripts = asRecord(packageJson.scripts, "package scripts");
    expect(scripts.prepare).toBe("effect-tsgo patch --oxlint");
    expect(scripts.check).toBe(
      "bun run check:auth-migrations && bun run check:auth-schema && bun run check:architecture && bun run check:no-raw-sql && bun run format:check && bun run lint"
    );
    expect(scripts.test).toBe("vitest run tests --maxWorkers=4");
    expect(packageSource).not.toContain("passWithNoTests");
  });
});
