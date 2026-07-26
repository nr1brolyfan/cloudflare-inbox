import { spawnSync } from "node:child_process";

const gitOutput = (args: readonly string[]): string => {
  const result = spawnSync("git", args, { encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error("release-check git inspection failed");
  }
  return result.stdout.trim();
};

const requireCleanWorktree = (): void => {
  if (gitOutput(["status", "--porcelain=v1", "--untracked-files=all"]) !== "") {
    throw new Error("release-check requires a clean worktree");
  }
};

const run = (command: string, args: readonly string[]): void => {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`release-check gate failed: ${args.join(" ")}`);
  }
};

const head = gitOutput(["rev-parse", "HEAD"]);
console.log(`release-check head=${head}`);
requireCleanWorktree();

run("bun", ["run", "check"]);
run("bun", ["run", "typecheck"]);
run("bun", ["run", "test"]);
run("bun", ["run", "test:mailbox-restore"]);
run("bun", ["run", "build"]);
run("git", ["diff", "--check"]);

requireCleanWorktree();
if (gitOutput(["rev-parse", "HEAD"]) !== head) {
  throw new Error("release-check HEAD changed during the gate");
}
console.log(`release-check ok head=${head}`);
