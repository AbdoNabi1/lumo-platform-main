import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, PaymentIntentRequest } from "@platform/contracts";
import { Money, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { wirePayments } from "./composition";
import { PaymentIntent } from "./domain/payment-intent";
import { InMemoryPaymentIntentRepository } from "./infrastructure/in-memory-payment-intent-repository";
import {
  InMemoryPaymentProvider,
  InMemoryProcessedWebhookStore,
} from "./infrastructure/in-memory-port-adapters";
import { PaymentEventTranslator } from "./infrastructure/payment-event-translator";

/**
 * ADR-0014 (WP-10, T10.3): one Payments composition serves every tenant. Covers the repository,
 * the webhook dedup store (which used to key on `(provider, eventId)` alone), the outbox tenant
 * merge, and the tenant handed to the PSP.
 */
function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-06-30T00:00:00.000Z") };

function usd(amountMinor: number): Money {
  const result = Money.create(amountMinor, "USD");
  if (!result.ok) throw new Error("test setup: invalid money");
  return result.value;
}

function repository() {
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new PaymentEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date(0) },
    producer: "payments",
  });
  return new InMemoryPaymentIntentRepository({
    outbox,
    context: rootEventContext(sequentialIds()),
  });
}

describe("payments tenant isolation (ADR-0014)", () => {
  it("two tenants sharing one repository and an identical intent id never see each other's rows", async () => {
    const repo = repository();
    await repo.save(
      PaymentIntent.create(UniqueEntityId.from("intent-1"), "order-1", usd(1000)),
      "tenant-a",
    );

    expect(await repo.findById("intent-1", "tenant-b")).toBeNull();
    expect(await repo.findByPspReference("psp-1", "tenant-b")).toBeNull();
    expect(await repo.findById("intent-1", "tenant-a")).not.toBeNull();
  });

  it("tenant A's webhook event id does not mark tenant B's identical id as processed", async () => {
    const store = new InMemoryProcessedWebhookStore();
    await store.markProcessed("stripe", "evt_1", "tenant-a");

    expect(await store.hasProcessed("stripe", "evt_1", "tenant-a")).toBe(true);
    expect(await store.hasProcessed("stripe", "evt_1", "tenant-b")).toBe(false);
  });

  it("RecordWebhook processes tenant B's webhook even after tenant A already handled the same event id", async () => {
    const app = wirePayments({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock,
    });
    const a = await app.payments.createIntentLifecycle({
      tenantId: "tenant-a",
      orderRef: "order-a",
      amountMinor: 1000,
      currency: "USD",
    });
    const b = await app.payments.createIntentLifecycle({
      tenantId: "tenant-b",
      orderRef: "order-b",
      amountMinor: 1000,
      currency: "USD",
    });
    const idA = (a.body as { paymentIntentId: string }).paymentIntentId;
    const idB = (b.body as { paymentIntentId: string }).paymentIntentId;

    const first = await app.payments.recordWebhook({
      tenantId: "tenant-a",
      paymentIntentId: idA,
      provider: "stripe",
      eventId: "evt_shared",
      kind: "cancelled",
    });
    const second = await app.payments.recordWebhook({
      tenantId: "tenant-b",
      paymentIntentId: idB,
      provider: "stripe",
      eventId: "evt_shared",
      kind: "cancelled",
    });

    expect((first.body as { duplicate: boolean }).duplicate).toBe(false);
    expect((second.body as { duplicate: boolean }).duplicate).toBe(false);
    expect((second.body as { status: string }).status).toBe("cancelled");
  });

  it("tenant B cannot reach tenant A's intent through the controller", async () => {
    const app = wirePayments({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock,
    });
    const created = await app.payments.createIntentLifecycle({
      tenantId: "tenant-a",
      orderRef: "order-a",
      amountMinor: 1000,
      currency: "USD",
    });
    const id = (created.body as { paymentIntentId: string }).paymentIntentId;

    const read = await app.payments.getPaymentIntent({ tenantId: "tenant-b", paymentIntentId: id });

    expect(read.status).toBe(404);
  });

  it("hands the PSP the request's tenant, not a hard-coded one", async () => {
    const seen: string[] = [];
    const provider = new InMemoryPaymentProvider();
    const recording = Object.assign(Object.create(provider) as InMemoryPaymentProvider, {
      createIntent: (request: PaymentIntentRequest) => {
        seen.push(request.tenantId);
        return provider.createIntent(request);
      },
    });
    const app = wirePayments({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock,
      paymentProvider: recording,
    });

    await app.payments.createIntentLifecycle({
      tenantId: "tenant-b",
      orderRef: "order-b",
      amountMinor: 1000,
      currency: "USD",
    });

    expect(seen).toEqual(["tenant-b"]);
  });

  it("merges the per-call tenantId into the outbox event context at write time", async () => {
    await assertWriteTimeTenant("payments", async (outbox, tenantId) => {
      const repo = new InMemoryPaymentIntentRepository({
        outbox,
        context: rootEventContext(sequentialIds()),
      });
      const intent = PaymentIntent.createIntent(
        UniqueEntityId.from("intent-1"),
        "order-1",
        usd(1000),
      );
      intent.transition("cancelled", "evt-1", new Date(0));
      await repo.save(intent, tenantId);
    });
  });
});
