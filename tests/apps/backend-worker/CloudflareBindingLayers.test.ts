import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { BackendHealthBindings } from "#/apps/backend-worker/BackendHealthLayer";
import {
  backendHealthBindingsLayer,
  draftAttachmentR2ClientLayer,
  inboundAttachmentR2ReadClientLayer,
  inboundRawMessageR2WriteClientLayer,
  inboundWorkflowClientLayer,
  mailboxDoNamespaceLayer,
  mailboxOutboundProviderLayer,
  outboundDraftAttachmentR2ReadClientLayer,
} from "#/apps/backend-worker/CloudflareBindingLayers";
import type { RawMessagesR2Binding } from "#/apps/backend-worker/CloudflareBindingLayers";
import { MailboxDoNamespace } from "#/modules/mailbox/adapters/durable-object/MailboxDoClient";
import { DraftAttachmentR2Client } from "#/modules/mailbox/adapters/r2/DraftAttachmentBlobStoreR2";
import { InboundAttachmentR2ReadClient } from "#/modules/mailbox/adapters/r2/InboundAttachmentBlobReaderR2";
import { InboundRawMessageR2WriteClient } from "#/modules/mailbox/adapters/r2/InboundRawMessageStoreR2";
import { OutboundDraftAttachmentR2ReadClient } from "#/modules/mailbox/adapters/r2/OutboundDraftAttachmentBlobReaderR2";
import { InboundWorkflowClient } from "#/modules/mailbox/adapters/workflow/InboundWorkflowStarterCloudflare";
import { OutboundEmailProvider } from "#/modules/mailbox/ports/OutboundEmailProvider";

const attachment = {
  arrayBuffer: () => Effect.succeed(new ArrayBuffer(0)),
  checksums: { sha256: new Uint8Array([0, 15, 255]).buffer },
  customMetadata: { source: "test" },
  httpMetadata: { contentType: "text/plain" },
  size: 3,
};

describe("backend Cloudflare binding Layers", () => {
  it("adapts Workflow and Durable Object handles without acquiring them", async () => {
    const workflow = {
      create: ({ id }: { readonly id: string }) => Effect.succeed({ id }),
      get: (id: string) => Effect.succeed({ id }),
    };
    const namespace = { getByName: (name: string) => ({ name }) };

    const [workflowClient, doNamespace] = await Effect.runPromise(
      Effect.all([
        InboundWorkflowClient.pipe(
          Effect.provide(inboundWorkflowClientLayer(workflow))
        ),
        MailboxDoNamespace.pipe(
          Effect.provide(mailboxDoNamespaceLayer(namespace as never))
        ),
      ])
    );

    await expect(
      Effect.runPromise(workflowClient.get("workflow-1"))
    ).resolves.toStrictEqual({ id: "workflow-1" });
    expect(doNamespace.getByName("mailbox-1")).toStrictEqual({
      name: "mailbox-1",
    });
  });

  it("normalizes checksums consistently for every attachment client", async () => {
    const rawMessages = {
      get: () => Effect.succeed(attachment),
      head: () => Effect.succeed(attachment),
      put: () => Effect.succeed(attachment),
    } as unknown as RawMessagesR2Binding;

    const [inbound, draft, outbound] = await Effect.runPromise(
      Effect.all([
        InboundAttachmentR2ReadClient.pipe(
          Effect.provide(inboundAttachmentR2ReadClientLayer(rawMessages))
        ),
        DraftAttachmentR2Client.pipe(
          Effect.provide(draftAttachmentR2ClientLayer(rawMessages))
        ),
        OutboundDraftAttachmentR2ReadClient.pipe(
          Effect.provide(outboundDraftAttachmentR2ReadClientLayer(rawMessages))
        ),
      ])
    );
    const [inboundObject, draftObject, outboundObject] =
      await Effect.runPromise(
        Effect.all([
          inbound.get("inbound"),
          draft.head("draft"),
          outbound.get("outbound"),
        ])
      );

    expect(inboundObject?.sha256).toBe("000fff");
    expect(draftObject?.sha256).toBe("000fff");
    expect(outboundObject?.sha256).toBe("000fff");
    expect(inboundObject?.customMetadata).toStrictEqual({ source: "test" });
  });

  it("provides ingress writes and keeps health bindings intact", async () => {
    let storedKey: string | undefined;
    const rawMessages = {
      put: (key: string) => {
        storedKey = key;
        return Effect.succeed({ size: 3 });
      },
    } as unknown as RawMessagesR2Binding;
    const health = {
      authRateLimit: { binding: "rate-limit" },
      mailboxDataPlane: { binding: "mailbox" },
      rawMessages,
    };
    const [writer, bindings] = await Effect.runPromise(
      Effect.all([
        InboundRawMessageR2WriteClient.pipe(
          Effect.provide(inboundRawMessageR2WriteClientLayer(rawMessages))
        ),
        BackendHealthBindings.pipe(
          Effect.provide(backendHealthBindingsLayer(health as never))
        ),
      ])
    );

    await Effect.runPromise(
      writer.put("raw/message", new ReadableStream(), {
        contentLength: 0,
        customMetadata: {},
        httpMetadata: { contentType: "message/rfc822" },
        onlyIf: { etagDoesNotMatch: "*" },
      })
    );

    expect(storedKey).toBe("raw/message");
    expect(bindings.rawMessages).toBe(rawMessages);
  });

  it("returns ready outbound Layers for absent and production bindings", async () => {
    const unavailable = await Effect.runPromise(
      OutboundEmailProvider.pipe(Effect.provide(mailboxOutboundProviderLayer()))
    );
    const production = await Effect.runPromise(
      OutboundEmailProvider.pipe(
        Effect.provide(
          mailboxOutboundProviderLayer({
            raw: Effect.succeed({ send: () => Promise.resolve({}) }),
          } as never)
        )
      )
    );

    expect(unavailable.send).toBeTypeOf("function");
    expect(production.send).toBeTypeOf("function");
  });
});
