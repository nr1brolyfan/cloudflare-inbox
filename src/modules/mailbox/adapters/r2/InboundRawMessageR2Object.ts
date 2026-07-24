export const inboundRawMessageObjectKey = (inboundIngestId: string) =>
  `inbound/${inboundIngestId}/raw.eml`;

export const inboundRawMessageRequiredMetadata = (input: {
  readonly inboundIngestId: string;
  readonly mailboxId: string;
  readonly rawSize: number;
  readonly receivedAt: number;
}) => ({
  "format-version": "1",
  "inbound-ingest-id": input.inboundIngestId,
  "mailbox-id": input.mailboxId,
  "object-type": "raw-message",
  "raw-size": String(input.rawSize),
  "received-at": String(input.receivedAt),
});

export const inboundRawMessageCustomMetadata = (input: {
  readonly envelopeFrom?: string;
  readonly envelopeTo: string;
  readonly inboundIngestId: string;
  readonly mailboxId: string;
  readonly rawSize: number;
  readonly receivedAt: number;
}) => ({
  ...inboundRawMessageRequiredMetadata(input),
  "envelope-to": input.envelopeTo,
  ...(input.envelopeFrom === undefined
    ? {}
    : { "envelope-from": input.envelopeFrom }),
});
