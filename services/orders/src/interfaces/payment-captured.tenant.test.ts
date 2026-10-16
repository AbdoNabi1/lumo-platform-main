import { describe, expect, it, vi } from "vitest";
import type { IntegrationEvent } from "@platform/domain-events";
import type { Logger } from "@platform/utils";
import type { MarkOrderPaid } from "../application/mark-order-paid.use-case";
import { PaymentCapturedConsumer, type PaymentCapturedPayload } from "./payment-captured.consumer";

/**
 * G-64: the tenant comes from the envelope. `payments.payment_intent.captured` is payment truth —
 * a capture that cannot be applied to an order leaves a customer charged and an order unpaid — so
 * an envelope with no tenant THROWS to the retry/DLQ pipeline instead of being acked.
 */
const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

function event(tenantId: string | undefined): IntegrationEvent<PaymentCapturedPayload> {
  return {
    messageId: `m-${tenantId ?? "none"}`,
    type: "payments.payment_intent.captured",
    eventVersion: 1,
    aggregateId: "intent-1",
    aggregateType: "payment_intent",
    occurredAt: "2026-09-26T00:00:00.000Z",
    correlationId: "c",
    causationId: "c",
    metadata: {},
    ...(tenantId === undefined ? {} : { tenantId }),
    payload: { orderRef: "order-1", amountMinor: 100, currency: "EUR" },
  } as IntegrationEvent<PaymentCapturedPayload>;
}

function make() {
  const execute = vi.fn(async (_input: { tenantId: string }) => ({ ok: true as const, value: {} }));
  const consumer = new PaymentCapturedConsumer({
    markOrderPaid: { execute } as unknown as MarkOrderPaid,
    logger,
  });
  return { consumer, execute };
}

describe("PaymentCapturedConsumer — envelope tenant (G-64)", () => {
  it("marks each order paid under its own event's tenant", async () => {
    const { consumer, execute } = make();
    await consumer.handle(event("tenant-a"));
    await consumer.handle(event("tenant-b"));
    expect(execute.mock.calls.map((c) => c[0].tenantId)).toEqual(["tenant-a", "tenant-b"]);
  });

  it.each([
    ["absent", undefined],
    ["empty", ""],
  ])("throws on an %s tenant and marks nothing paid", async (_n, tenant) => {
    const { consumer, execute } = make();
    await expect(consumer.handle(event(tenant))).rejects.toThrow(/tenant/i);
    expect(execute).not.toHaveBeenCalled();
  });
});
