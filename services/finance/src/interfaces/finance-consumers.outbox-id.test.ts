import { describe, expect, it, vi } from "vitest";
import { JsonEventSerializer, type IntegrationEvent } from "@platform/domain-events";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import type { Journal } from "../domain/journal";
import { FinanceEventTranslator } from "../infrastructure/finance-event-translator";
import {
  OrdersPaidConsumer,
  PaymentsCapturedConsumer,
  RefundsIssuedConsumer,
  type FinanceConsumerDeps,
} from "./finance-consumers";

/**
 * G-83. A ledger posting writes its integration event to `platform.outbox`, whose primary key IS
 * the domain event's `eventId` (`OutboxWriter.toEntry`: `id: envelope.messageId`). The message
 * that triggered the posting is already a row in that same table under its own id — so a posting
 * that reuses `event.messageId` as its event id collides with the row being delivered:
 *
 *     Invalid `prisma.outboxEntry.createMany()` invocation:
 *     Unique constraint failed on the fields: (`id`)
 *
 * deterministically, for every paid order, so no sale ever reached the ledger. Observed in
 * production on 2026-10-02 on the first deployment that ever ran these consumers, after two years
 * of green unit tests that never wrote an outbox row.
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

const INCOMING_MESSAGE_ID = "01a06d13-0f12-7ddc-a011-b10e01abde1f";

function setup() {
  const appended: Journal[] = [];
  const deps = {
    journals: {
      append: vi.fn(async (journal: Journal) => {
        appended.push(journal);
      }),
    } as unknown as FinanceConsumerDeps["journals"],
    postingAccounts: POSTING as unknown as FinanceConsumerDeps["postingAccounts"],
    idGenerator: { generate: () => crypto.randomUUID() },
    clock: { now: () => new Date("2026-10-02T00:00:00.000Z") },
  } satisfies FinanceConsumerDeps;
  return { deps, appended };
}

function incoming(
  type: string,
  messageId = INCOMING_MESSAGE_ID,
): IntegrationEvent<{ orderRef: string; amountMinor: number; currency: string }> {
  return {
    messageId,
    type,
    eventVersion: 1,
    aggregateId: "o-1",
    aggregateType: "order",
    occurredAt: "2026-10-02T00:00:00.000Z",
    correlationId: "c",
    causationId: "c",
    tenantId: "tenant-local",
    metadata: {},
    payload: { orderRef: "ORD-1", amountMinor: 1000, currency: "EUR" },
  } as never;
}

const CONSUMERS = [
  ["orders.order.paid", (deps: FinanceConsumerDeps) => new OrdersPaidConsumer(deps)],
  [
    "payments.payment_intent.captured",
    (deps: FinanceConsumerDeps) => new PaymentsCapturedConsumer(deps),
  ],
  [
    "payments.payment_intent.refunded",
    (deps: FinanceConsumerDeps) => new RefundsIssuedConsumer(deps),
  ],
] as const;

describe("finance ledger consumers — the posted event never reuses the incoming message id", () => {
  it.each(CONSUMERS)("%s", async (type, build) => {
    const { deps, appended } = setup();

    await build(deps).handle(incoming(type));

    const events = appended[0]?.pullDomainEvents() ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]?.eventId).not.toBe(INCOMING_MESSAGE_ID);
  });

  /**
   * The end the bug was actually felt at: the outbox row the append writes must not collide with
   * the row being delivered. `InMemoryOutboxStore` does not enforce the primary key, so the ids
   * are compared directly — which is the constraint Postgres enforces.
   */
  it("writes an outbox entry whose id is free, not the id of the row being delivered", async () => {
    const { deps, appended } = setup();
    const store = new InMemoryOutboxStore();
    const writer = new OutboxWriter({
      store,
      translator: new FinanceEventTranslator(),
      serializer: new JsonEventSerializer(),
      clock: deps.clock,
      producer: "finance",
    });

    // The incoming message, as it exists in `platform.outbox` before delivery.
    const delivered = { id: INCOMING_MESSAGE_ID };

    await new OrdersPaidConsumer(deps).handle(incoming("orders.order.paid"));
    await writer.write(
      appended[0]?.pullDomainEvents() ?? [],
      { ...rootEventContext({ generate: () => "ctx" }), tenantId: "tenant-local" },
      undefined,
    );

    const written = store.snapshot();
    expect(written).toHaveLength(1);
    expect(written[0]?.id).not.toBe(delivered.id);
  });
});
