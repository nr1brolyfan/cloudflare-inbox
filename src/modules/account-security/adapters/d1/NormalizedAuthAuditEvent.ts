const textEncoder = new TextEncoder();

export const normalizedAuthAuditEvent = <
  Event extends { readonly occurredAt: number; readonly type: string },
>(
  event: Event
) => {
  const eventJson = JSON.stringify(event);

  return {
    event: eventJson,
    eventBytes: textEncoder.encode(eventJson).byteLength,
    normalizationVersion: 1 as const,
    occurredAt: event.occurredAt,
    type: event.type,
  };
};
