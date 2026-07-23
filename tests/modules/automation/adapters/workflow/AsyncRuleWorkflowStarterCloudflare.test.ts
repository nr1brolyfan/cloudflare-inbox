import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  AsyncRuleWorkflowClient,
  AsyncRuleWorkflowStarterCloudflareLayer,
} from "#/modules/automation/adapters/workflow/AsyncRuleWorkflowStarterCloudflare";
import type { AsyncRuleWorkflowClientService } from "#/modules/automation/adapters/workflow/AsyncRuleWorkflowStarterCloudflare";
import {
  AsyncRuleWorkflowParams,
  AsyncRuleWorkflowStarter,
} from "#/modules/automation/ports/AsyncRuleWorkflowStarter";

const params = Schema.decodeUnknownSync(AsyncRuleWorkflowParams)({
  formatVersion: 1,
  jobId: "job-1",
  mailboxId: "primary",
});

const run = (client: AsyncRuleWorkflowClientService) =>
  Effect.runPromise(
    Effect.result(
      AsyncRuleWorkflowStarter.pipe(
        Effect.flatMap((starter) => starter.start(params)),
        Effect.provide(
          AsyncRuleWorkflowStarterCloudflareLayer.pipe(
            Layer.provide(
              Layer.succeed(
                AsyncRuleWorkflowClient,
                AsyncRuleWorkflowClient.of(client)
              )
            )
          )
        )
      )
    )
  );

describe("async rule Workflow starter", () => {
  it("starts a deterministic instance", async () => {
    let options: unknown;
    const result = await run({
      create: (value) => {
        options = value;
        return Effect.succeed({ id: value.id });
      },
      get: () => Effect.die("get must not run"),
    });

    expect(Result.isSuccess(result)).toBeTruthy();
    expect(options).toStrictEqual({ id: "job-1", params });
  });

  it("confirms an existing instance after an ambiguous create failure", async () => {
    const result = await run({
      create: () => Effect.fail("response lost"),
      get: (id) => Effect.succeed({ id }),
    });

    expect(Result.isSuccess(result)).toBeTruthy();
  });

  it("returns a typed start error when create and get fail", async () => {
    const result = await run({
      create: () => Effect.fail("create failed"),
      get: () => Effect.fail("get failed"),
    });

    expect(Result.isFailure(result) ? result.failure : undefined).toMatchObject(
      {
        _tag: "WorkflowStartError",
        instanceId: "job-1",
        workflow: "async-rules",
      }
    );
  });
});
