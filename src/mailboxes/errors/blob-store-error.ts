import * as Data from "effect/Data";

export class BlobStoreError extends Data.TaggedError("BlobStoreError")<{
  readonly operation: "read" | "write" | "head" | "delete";
  readonly objectType: "raw-message" | "body" | "attachment";
  readonly message: string;
  readonly cause: unknown;
}> {}
