/**
 * Distributed **context propagation** for the Security context (H-4 / G-SEC-3). A small value object that
 * carries the request's correlation / request / principal / tenant ids, the W3C **traceparent**, and
 * **baggage** across every hop — HTTP (headers), messaging + outbox (event metadata), and background
 * workers (child contexts) — so a zero-trust decision, its audit record, and the async events it emits all
 * share one trace + correlation id. It reuses the platform's existing correlation-id plumbing (the same
 * ids the HTTP server and `IntegrationEvent` already carry) and the W3C trace-context standard; it is not a
 * new tracing engine. Never carries secrets/tokens — only ids and non-sensitive baggage.
 */
const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

export interface SecurityContextFields {
  readonly correlationId: string;
  readonly requestId: string;
  readonly principalId?: string;
  readonly tenantId?: string;
  /** W3C `traceparent` (`00-<traceId>-<spanId>-<flags>`), when a trace is in flight. */
  readonly traceparent?: string;
  /** W3C baggage — small, non-sensitive key/values propagated with the request. */
  readonly baggage?: Readonly<Record<string, string>>;
}

type Headers = Record<string, string | string[] | undefined>;

function headerValue(headers: Headers, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value) && value.length > 0) return value[0];
  return undefined;
}

function parseBaggage(raw: string | undefined): Record<string, string> {
  if (raw === undefined) return {};
  const out: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const [key, value] = pair.split("=");
    if (key !== undefined && value !== undefined && key.trim().length > 0)
      out[key.trim()] = value.trim();
  }
  return out;
}

function formatBaggage(baggage: Readonly<Record<string, string>>): string {
  return Object.entries(baggage)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
}

export class SecurityPropagationContext {
  readonly correlationId: string;
  readonly requestId: string;
  readonly principalId: string | undefined;
  readonly tenantId: string | undefined;
  readonly traceparent: string | undefined;
  readonly baggage: Readonly<Record<string, string>>;

  constructor(fields: SecurityContextFields) {
    this.correlationId = fields.correlationId;
    this.requestId = fields.requestId;
    this.principalId = fields.principalId;
    this.tenantId = fields.tenantId;
    this.traceparent =
      fields.traceparent !== undefined && TRACEPARENT.test(fields.traceparent)
        ? fields.traceparent
        : undefined;
    this.baggage = fields.baggage ?? {};
  }

  /** Extracts a context from inbound HTTP headers (the edge entry point). */
  static fromHttpHeaders(headers: Headers, fallbackRequestId: string): SecurityPropagationContext {
    const correlationId = headerValue(headers, "x-correlation-id") ?? fallbackRequestId;
    const requestId = headerValue(headers, "x-request-id") ?? fallbackRequestId;
    return new SecurityPropagationContext({
      correlationId,
      requestId,
      ...(headerValue(headers, "traceparent") !== undefined
        ? { traceparent: headerValue(headers, "traceparent") }
        : {}),
      baggage: parseBaggage(headerValue(headers, "baggage")),
    });
  }

  /** Reconstructs a context from an inbound event's metadata (messaging / outbox consumer). */
  static fromEventMetadata(
    metadata: Readonly<Record<string, string>>,
    correlationId: string,
  ): SecurityPropagationContext {
    return new SecurityPropagationContext({
      correlationId,
      requestId: metadata["requestId"] ?? correlationId,
      ...(metadata["principalId"] !== undefined ? { principalId: metadata["principalId"] } : {}),
      ...(metadata["tenantId"] !== undefined ? { tenantId: metadata["tenantId"] } : {}),
      ...(metadata["traceparent"] !== undefined ? { traceparent: metadata["traceparent"] } : {}),
      baggage: parseBaggage(metadata["baggage"]),
    });
  }

  /** Headers to inject on an outbound HTTP call (propagates trace + correlation downstream). */
  toHttpHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "x-correlation-id": this.correlationId,
      "x-request-id": this.requestId,
    };
    if (this.traceparent !== undefined) headers["traceparent"] = this.traceparent;
    if (Object.keys(this.baggage).length > 0) headers["baggage"] = formatBaggage(this.baggage);
    return headers;
  }

  /** Non-sensitive metadata to attach to an emitted event (messaging + outbox propagation). */
  toEventMetadata(): Record<string, string> {
    const metadata: Record<string, string> = { requestId: this.requestId };
    if (this.principalId !== undefined) metadata["principalId"] = this.principalId;
    if (this.tenantId !== undefined) metadata["tenantId"] = this.tenantId;
    if (this.traceparent !== undefined) metadata["traceparent"] = this.traceparent;
    if (Object.keys(this.baggage).length > 0) metadata["baggage"] = formatBaggage(this.baggage);
    return metadata;
  }

  /** A child context for a background worker step — same correlation/trace, its own request id. */
  forWorker(workerRequestId: string): SecurityPropagationContext {
    return new SecurityPropagationContext({ ...this.fields(), requestId: workerRequestId });
  }

  /** Returns a copy with an added/overridden baggage entry (immutable). */
  withBaggage(key: string, value: string): SecurityPropagationContext {
    return new SecurityPropagationContext({
      ...this.fields(),
      baggage: { ...this.baggage, [key]: value },
    });
  }

  private fields(): SecurityContextFields {
    return {
      correlationId: this.correlationId,
      requestId: this.requestId,
      ...(this.principalId !== undefined ? { principalId: this.principalId } : {}),
      ...(this.tenantId !== undefined ? { tenantId: this.tenantId } : {}),
      ...(this.traceparent !== undefined ? { traceparent: this.traceparent } : {}),
      baggage: this.baggage,
    };
  }
}
