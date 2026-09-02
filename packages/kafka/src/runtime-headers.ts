/**
 * Runtime header codec (pure). Two concerns:
 *
 * 1. **Redelivery bookkeeping** (`x-retry-*`): attempt count, due time, original topic and
 *    consumer group — written when scheduling a retry, read by the retry consumer.
 * 2. **Trace propagation** (Step 8): `traceparent` / `tracestate` / `baggage` are propagated
 *    VERBATIM from the consumed message into every retry/DLQ publish, so a message's trace
 *    context survives the whole redelivery journey. Full OTel span creation lands with the
 *    instrumentation sprint (G-19) — propagation is correct today and needs no SDK.
 */
export const TRACE_HEADERS = ["traceparent", "tracestate", "baggage"] as const;

export interface RetryHeaders {
  readonly attempt: number;
  readonly dueAtMs: number;
  readonly originalTopic: string;
  readonly consumerGroup: string;
}

export function encodeRetryHeaders(retry: RetryHeaders): Record<string, string> {
  return {
    "x-retry-attempt": String(retry.attempt),
    "x-retry-due-at": String(retry.dueAtMs),
    "x-retry-original-topic": retry.originalTopic,
    "x-retry-consumer-group": retry.consumerGroup,
  };
}

export function decodeRetryHeaders(headers: Readonly<Record<string, string>>): RetryHeaders | null {
  const attempt = Number(headers["x-retry-attempt"]);
  const dueAtMs = Number(headers["x-retry-due-at"]);
  const originalTopic = headers["x-retry-original-topic"];
  const consumerGroup = headers["x-retry-consumer-group"];
  if (!Number.isInteger(attempt) || attempt < 1) return null;
  if (!Number.isFinite(dueAtMs)) return null;
  if (originalTopic === undefined || consumerGroup === undefined) return null;
  return { attempt, dueAtMs, originalTopic, consumerGroup };
}

/** Picks the trace-propagation headers out of a header bag (verbatim passthrough). */
export function traceHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of TRACE_HEADERS) {
    const value = headers[name];
    if (value !== undefined) out[name] = value;
  }
  return out;
}
