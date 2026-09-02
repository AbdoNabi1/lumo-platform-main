import { trace } from "@opentelemetry/api";
import { logger, type Logger, type LogFields } from "@platform/utils";

export { logger, type Logger, type LogFields };

/** Log fields enriched with the active trace/span ids, for log↔trace correlation. */
export function traceFields(): LogFields {
  const span = trace.getActiveSpan();
  if (!span) return {};
  const spanContext = span.spanContext();
  return { traceId: spanContext.traceId, spanId: spanContext.spanId };
}
