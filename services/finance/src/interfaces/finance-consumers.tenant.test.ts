import { describe, expect, it, vi } from "vitest";
import type { IntegrationEvent } from "@platform/domain-events";
import { OrdersPaidConsumer, type FinanceConsumerDeps } from "./finance-consumers";

/**
 * G-64 boundary, finance side: a ledger entry is money, so an envelope whose tenant is anything but a
 * non-blank string is refused (the message goes to retry → DLQ) and NOTHING is posted. Off the wire the
 * type is not a guarantee: `JSON.parse` hands back whatever the producer sent.
 */
const POSTING = {
  revenue: "4000",
  receivable: "1200",
  cogs: "5000",
  inventory: "1300",
  refundContra: "4900",
  expense: "6000",
  cash: "1000",
  fees: "6100",
};

function setup() {
  const append = vi.fn(async () => undefined);
  const deps = {
    journals: { append } as unknown as FinanceConsumerDeps["journals"],
    postingAccounts: POSTING as unknown as FinanceConsumerDeps["postingAccounts"],
    idGenerator: { generate: () => crypto.randomUUID() },
    clock: { now: () => new Date("2026-09-26T00:00:00.000Z") },
  } satisfies FinanceConsumerDeps;
  return { consumer: new OrdersPaidConsumer(deps), append };
}

const event = (
  tenantId: unknown,
): IntegrationEvent<{ orderRef: string; amountMinor: number; currency: string }> =>
  ({
    messageId: "m-1",
    type: "orders.order.paid",
    eventVersion: 1,
    aggregateId: "o-1",
    aggregateType: "order",
    occurredAt: "2026-09-26T00:00:00.000Z",
    correlationId: "c",
    causationId: "c",
    metadata: {},
    ...(tenantId === undefined ? {} : { tenantId }),
    payload: { orderRef: "ORD-1", amountMinor: 1000, currency: "EUR" },
  }) as never;

describe("finance ledger consumers — the envelope tenant is required, never guessed", () => {
  it("posts under the envelope's tenant", async () => {
    const { consumer, append } = setup();
    await consumer.handle(event("tenant-b"));
    expect(append).toHaveBeenCalledTimes(1);
    expect((append.mock.calls[0] as unknown[])[1]).toBe("tenant-b");
  });

  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["blank", "   "],
    ["null", null],
    ["a number", 42],
    ["an object", { id: "tenant-a" }],
    ["an array", ["tenant-a"]],
  ])("refuses %s and posts nothing", async (_label, tenantId) => {
    const { consumer, append } = setup();
    await expect(consumer.handle(event(tenantId))).rejects.toThrow(/tenantId/);
    expect(append).not.toHaveBeenCalled();
  });
});
