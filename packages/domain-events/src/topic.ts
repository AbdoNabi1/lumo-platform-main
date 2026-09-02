/** Matches an event type `<context>.<aggregate>.<event>` (lower snake-case segments). */
export const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/**
 * Builds the versioned topic name for an event type, e.g. (`orders.order.placed`, 1) →
 * `orders.order.placed.v1` (topic/versioning scheme, docs/architecture/05 §1.2). Throws on
 * developer misuse (an invalid type or version) — these are programming errors, not domain
 * failures, so this contract package stays dependency-free.
 */
export function topicFor(eventType: string, eventVersion: number): string {
  if (!EVENT_TYPE_PATTERN.test(eventType)) {
    throw new Error(
      `Invalid event type "${eventType}" (expected "<context>.<aggregate>.<event>").`,
    );
  }
  if (!Number.isInteger(eventVersion) || eventVersion < 1) {
    throw new Error(`Invalid event version "${eventVersion}" (expected an integer >= 1).`);
  }
  return `${eventType}.v${eventVersion}`;
}
