import { describe, expect, it } from "vitest";
import { DEFAULT_RETRY_SCHEDULE, delayForAttempt, maxAttempts } from "./retry-schedule";
import { decodeRetryHeaders, encodeRetryHeaders, traceHeaders } from "./runtime-headers";

describe("retry schedule", () => {
  it("implements the production ladder: 5s, 30s, 2m, 10m, 1h", () => {
    expect(DEFAULT_RETRY_SCHEDULE.delaysMs).toEqual([5_000, 30_000, 120_000, 600_000, 3_600_000]);
    expect(maxAttempts(DEFAULT_RETRY_SCHEDULE)).toBe(5);
    expect(delayForAttempt(DEFAULT_RETRY_SCHEDULE, 1)).toBe(5_000);
    expect(delayForAttempt(DEFAULT_RETRY_SCHEDULE, 5)).toBe(3_600_000);
  });

  it("rejects attempts beyond the schedule (programming error)", () => {
    expect(() => delayForAttempt(DEFAULT_RETRY_SCHEDULE, 6)).toThrow(/exceeds max 5/);
  });
});

describe("runtime headers", () => {
  it("round-trips retry bookkeeping", () => {
    const encoded = encodeRetryHeaders({
      attempt: 3,
      dueAtMs: 1_750_000_000_000,
      originalTopic: "orders.order.paid.v1",
      consumerGroup: "orders.payment-captured",
    });
    expect(decodeRetryHeaders(encoded)).toEqual({
      attempt: 3,
      dueAtMs: 1_750_000_000_000,
      originalTopic: "orders.order.paid.v1",
      consumerGroup: "orders.payment-captured",
    });
  });

  it("returns null for non-retry messages and malformed bookkeeping", () => {
    expect(decodeRetryHeaders({})).toBeNull();
    expect(decodeRetryHeaders({ "x-retry-attempt": "0", "x-retry-due-at": "1" })).toBeNull();
  });

  it("propagates exactly the W3C trace headers, verbatim", () => {
    const headers = {
      traceparent: "00-abc-def-01",
      tracestate: "vendor=1",
      baggage: "tenantId=t-1",
      type: "orders.order.paid",
      secret: "x",
    };
    expect(traceHeaders(headers)).toEqual({
      traceparent: "00-abc-def-01",
      tracestate: "vendor=1",
      baggage: "tenantId=t-1",
    });
  });
});
