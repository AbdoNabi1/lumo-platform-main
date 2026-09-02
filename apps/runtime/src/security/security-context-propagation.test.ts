import { describe, expect, it } from "vitest";
import { SecurityPropagationContext } from "./security-context-propagation";

const TRACEPARENT = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

describe("SecurityPropagationContext", () => {
  it("extracts context from HTTP headers including traceparent + baggage", () => {
    const ctx = SecurityPropagationContext.fromHttpHeaders(
      {
        "x-correlation-id": "c-1",
        "x-request-id": "r-1",
        traceparent: TRACEPARENT,
        baggage: "region=eu,tier=gold",
      },
      "fallback",
    );
    expect(ctx.correlationId).toBe("c-1");
    expect(ctx.requestId).toBe("r-1");
    expect(ctx.traceparent).toBe(TRACEPARENT);
    expect(ctx.baggage).toEqual({ region: "eu", tier: "gold" });
  });

  it("falls back to the request id and rejects a malformed traceparent", () => {
    const ctx = SecurityPropagationContext.fromHttpHeaders(
      { traceparent: "not-a-traceparent" },
      "req-9",
    );
    expect(ctx.correlationId).toBe("req-9");
    expect(ctx.requestId).toBe("req-9");
    expect(ctx.traceparent).toBeUndefined();
  });

  it("round-trips HTTP → event metadata → reconstructed context", () => {
    const ctx = new SecurityPropagationContext({
      correlationId: "c-1",
      requestId: "r-1",
      principalId: "p-1",
      tenantId: "t-1",
      traceparent: TRACEPARENT,
      baggage: { k: "v" },
    });
    const metadata = ctx.toEventMetadata();
    expect(metadata).toMatchObject({
      requestId: "r-1",
      principalId: "p-1",
      tenantId: "t-1",
      traceparent: TRACEPARENT,
      baggage: "k=v",
    });

    const restored = SecurityPropagationContext.fromEventMetadata(metadata, "c-1");
    expect(restored.correlationId).toBe("c-1");
    expect(restored.principalId).toBe("p-1");
    expect(restored.tenantId).toBe("t-1");
    expect(restored.traceparent).toBe(TRACEPARENT);
    expect(restored.baggage).toEqual({ k: "v" });
  });

  it("injects propagation headers for outbound HTTP calls", () => {
    const ctx = new SecurityPropagationContext({
      correlationId: "c-1",
      requestId: "r-1",
      traceparent: TRACEPARENT,
    });
    expect(ctx.toHttpHeaders()).toEqual({
      "x-correlation-id": "c-1",
      "x-request-id": "r-1",
      traceparent: TRACEPARENT,
    });
  });

  it("derives a worker child context that keeps correlation + trace but takes a new request id", () => {
    const ctx = new SecurityPropagationContext({
      correlationId: "c-1",
      requestId: "r-1",
      traceparent: TRACEPARENT,
      baggage: { a: "b" },
    });
    const child = ctx.forWorker("worker-req-2");
    expect(child.correlationId).toBe("c-1");
    expect(child.requestId).toBe("worker-req-2");
    expect(child.traceparent).toBe(TRACEPARENT);
    expect(child.baggage).toEqual({ a: "b" });
  });

  it("adds baggage immutably", () => {
    const ctx = new SecurityPropagationContext({ correlationId: "c-1", requestId: "r-1" });
    const withBag = ctx.withBaggage("k", "v");
    expect(ctx.baggage).toEqual({});
    expect(withBag.baggage).toEqual({ k: "v" });
  });
});
