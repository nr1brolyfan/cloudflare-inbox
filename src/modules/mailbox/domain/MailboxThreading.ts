import * as Schema from "effect/Schema";

import { RfcMessageId } from "#/modules/mailbox/domain/Mailbox";

export const maximumThreadingMessageIdBytes = 998;
export const maximumThreadingHeaderBytes = 2048;

/** Conservative provider-safe profile, not the complete RFC 5322 msg-id grammar. */
export const isProviderSafeRfcMessageId = (
  candidate: string
): candidate is Schema.Schema.Type<typeof RfcMessageId> => {
  if (
    new TextEncoder().encode(candidate).byteLength >
      maximumThreadingMessageIdBytes ||
    !/^<[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~.]+@[A-Za-z0-9.-]+>$/u.test(candidate)
  ) {
    return false;
  }
  const separator = candidate.indexOf("@");
  const idLeft = candidate.slice(1, separator);
  const labels = candidate.slice(separator + 1, -1).split(".");
  return (
    !idLeft.startsWith(".") &&
    !idLeft.endsWith(".") &&
    !idLeft.includes("..") &&
    labels.every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        !label.startsWith("-") &&
        !label.endsWith("-")
    )
  );
};

export const ProviderSafeRfcMessageId = RfcMessageId.check(
  Schema.makeFilter((value) =>
    isProviderSafeRfcMessageId(value)
      ? undefined
      : "must be a conservative provider-safe RFC message ID"
  )
);

export const serializeThreadingReferences = (
  references: readonly Schema.Schema.Type<typeof RfcMessageId>[]
) => references.join(" ");

export const OutboundThreadingMetadata = Schema.Struct({
  inReplyTo: ProviderSafeRfcMessageId,
  references: Schema.Array(ProviderSafeRfcMessageId),
}).check(
  Schema.makeFilter((threading) => {
    if (new Set(threading.references).size !== threading.references.length) {
      return "References must contain unique message IDs";
    }
    if (threading.references.at(-1) !== threading.inReplyTo) {
      return "References must end with the In-Reply-To parent";
    }
    return new TextEncoder().encode(
      serializeThreadingReferences(threading.references)
    ).byteLength <= maximumThreadingHeaderBytes
      ? undefined
      : `References cannot exceed ${maximumThreadingHeaderBytes} UTF-8 bytes`;
  })
);
export type OutboundThreadingMetadata = Schema.Schema.Type<
  typeof OutboundThreadingMetadata
>;
