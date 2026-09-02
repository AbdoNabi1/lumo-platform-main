import { SpanStatusCode, trace, type Span, type Tracer } from "@opentelemetry/api";

export function getTracer(name: string, version?: string): Tracer {
  return trace.getTracer(name, version);
}

/** Runs `fn` inside a new active span, recording exceptions and ending the span. */
export async function withSpan<T>(
  tracer: Tracer,
  name: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      span.recordException(error instanceof Error ? error : new Error(message));
      throw error;
    } finally {
      span.end();
    }
  });
}
